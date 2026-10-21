import { performance } from "node:perf_hooks";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import * as authApi from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";
import { constrainedPersistenceFixture, persistenceFixture } from "./persistence-fixture.js";

const root = "apps/api/src/platform";
function fixture() {
  const config = targetConfig();
  for (const endpoint of config.endpoints) endpoint.audit = true;
  const project = resolvedFixture(config);
  const result = generateBackend(project, "api");
  if (!result.success) throw Error("Invalid audited project");
  return { config, project, files: result.virtualFileSystem.snapshot() };
}
type RecordEvent = {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};
interface Service {
  record(
    event: {
      actorId?: string;
      action: string;
      resourceType: string;
      resourceId?: string | null;
      before?: unknown;
      after?: unknown;
      metadata?: unknown;
    },
    headers?: Headers,
  ): void;
}
function runtime() {
  const f = fixture();
  return {
    ...f,
    load: generatedRuntime(f.files)(`${root}/audit/runtime.ts`) as {
      safeAuditValue: (value: unknown) => unknown;
      createAuditService: (
        write: (event: RecordEvent) => Promise<unknown>,
        context?: { waitUntil: (task: Promise<unknown>) => void },
        report?: () => void,
      ) => Service;
      beginBusinessAudit: (
        request: Request,
        operations: unknown[],
        audit: Service,
      ) => {
        actor: (id: string) => void;
        capture: (change: unknown) => void;
        finish: (status: number) => void;
      };
      authAuditAction: (path: string, newSession: boolean, returned: unknown) => string | undefined;
    },
  };
}
describe("unified audit capture", () => {
  it("presents user names and structured request fields without exposing IDs as names", () => {
    const f = fixture();
    const files = generateFrontend(f.project, "web").virtualFileSystem.snapshot();
    const presentation = generatedRuntime(files)(
      "apps/web/src/lib/iam/activity-presentation.ts",
    ) as {
      userLabel: (entry: Record<string, unknown>) => string;
      actionLabel: (action: string) => string;
      requestDetails: (entry: Record<string, unknown>) => { label: string; value: string }[];
      changes: (before: unknown, after: unknown) => unknown[];
    };
    expect(
      presentation.userLabel({
        actorId: "internal-user-id",
        actorName: "Jane Doe",
        actorEmail: "jane@example.test",
      }),
    ).toBe("Jane Doe");
    expect(presentation.userLabel({ actorId: "deleted-user-id" })).toBe("Unknown or deleted user");
    expect(presentation.userLabel({ actorId: "anonymous" })).toBe("Anonymous visitor");
    expect(presentation.userLabel({ actorId: "system" })).toBe("System");
    expect(presentation.actionLabel("auth.signin")).toBe("Signed in");
    expect(presentation.actionLabel("note.created")).toBe("Created note");
    const fields = presentation.requestDetails({
      ipAddress: "127.0.0.1",
      userAgent: "Example browser",
      metadata: {
        method: "POST",
        path: "/api/notes",
        status: 200,
        durationMs: 12.345,
        params: { noteId: "record-id" },
        query: {},
        resourceIds: ["record-id"],
        custom: { retryCount: 1 },
      },
    });
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: "Method", value: "POST" },
        { label: "Route", value: "/api/notes" },
        { label: "Response status", value: "200" },
        { label: "Duration", value: "12.3 ms" },
        { label: "Route parameters · note Id", value: "record-id" },
        { label: "custom · retry Count", value: "1" },
      ]),
    );
    expect(presentation.requestDetails({ metadata: null })).toEqual([]);
    expect(presentation.changes(null, null)).toEqual([]);
    expect(presentation.changes({ title: "Old" }, { title: "New" })).toEqual([
      { path: "$.title", before: "Old", after: "New" },
    ]);
    expect(files["apps/web/src/components/iam/administration.tsx"]).not.toContain("AuditActivity");
    expect(files["apps/web/src/components/iam/administration.tsx"]).not.toContain(
      'id="iam-activity-tab"',
    );
    expect(files["apps/web/src/app/audit/page.tsx"]).toContain("<h1>Activity</h1>");
    expect(f.files[`${root}/audit/store.ts`]).toContain("leftJoin(authUser");
  });
  it("generates audited reads, custom operations and hard/boolean/timestamp deletes", () => {
    for (const softDelete of [false, "boolean", "timestamp"] as const) {
      const config = persistenceFixture();
      config.entities.Invoice.softDelete = softDelete;
      for (const endpoint of config.endpoints) endpoint.audit = true;
      const base = config.endpoints.find((endpoint) => endpoint.operationId === "listInvoices");
      if (!base) throw Error("Missing list fixture");
      const custom = structuredClone(base);
      custom.pagination = undefined;
      custom.operationId = "inspectInvoices";
      custom.method = "POST";
      custom.path = "/api/invoices/inspect";
      config.endpoints.push(custom);
      const generated = generateBackend(resolvedFixture(config), "api");
      expect(generated.success).toBe(true);
      if (!generated.success) return;
      const files = generated.virtualFileSystem.snapshot();
      expect(
        files[
          "apps/api/src/modules/billing/infrastructure/adapters/DeleteInvoice.drizzle.query.adapter.ts"
        ],
      ).toContain('for("update")');
    }
    const config = constrainedPersistenceFixture();
    for (const endpoint of config.endpoints) endpoint.audit = true;
    const generated = generateBackend(resolvedFixture(config), "api");
    expect(generated.success).toBe(true);
    if (generated.success)
      expect(generated.virtualFileSystem.readFile("apps/api/src/index.ts")).toContain(
        "audit.capture",
      );
  });
  it("returns an application response while persistence is deliberately unresolved, using waitUntil", async () => {
    const { load } = runtime();
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const tasks: Promise<unknown>[] = [];
    const write = vi.fn(() => pending);
    const service = load.createAuditService(write, { waitUntil: (task) => tasks.push(task) });
    const started = performance.now();
    const response = await Promise.race([
      (async () => {
        service.record({ action: "orders.created", resourceType: "order" });
        return new Response("created", { status: 201 });
      })(),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(Error("Response waited for audit")), 1000),
      ),
    ]);
    expect(response.status).toBe(201);
    expect(write).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    let settled = false;
    void tasks[0].then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
    complete();
    await tasks[0];
  });
  it("isolates async and synchronous writer failures in both Node and Worker dispatch", async () => {
    const { load } = runtime();
    const report = vi.fn();
    const tasks: Promise<unknown>[] = [];
    const service = load.createAuditService(
      async () => {
        throw Error("private database error");
      },
      { waitUntil: (task) => tasks.push(task) },
      report,
    );
    expect(() =>
      service.record({ action: "iam.role.updated", resourceType: "role" }),
    ).not.toThrow();
    await Promise.all(tasks);
    expect(report).toHaveBeenCalledOnce();
    const node = load.createAuditService(
      () => {
        throw Error("sync failure");
      },
      undefined,
      report,
    );
    node.record({ action: "test", resourceType: "test" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledTimes(2);
    const failedContext = load.createAuditService(
      async () => {},
      {
        waitUntil() {
          throw Error("context closed");
        },
      },
      () => {
        throw Error("logger unavailable");
      },
    );
    expect(() => failedContext.record({ action: "test", resourceType: "test" })).not.toThrow();
  });
  it("copies snapshots, redacts credentials recursively and bounds stored values", async () => {
    const { load } = runtime();
    const events: RecordEvent[] = [];
    const tasks: Promise<unknown>[] = [];
    const service = load.createAuditService(
      async (event) => {
        events.push(event);
      },
      { waitUntil: (task) => tasks.push(task) },
    );
    const after = {
      name: "Before later mutation",
      nested: { password: "secret", accessToken: "sensitive", cookie: "session", otp: "123456" },
      amount: 2.5,
    };
    service.record(
      {
        actorId: "operator",
        action: "order.updated",
        resourceType: "order",
        resourceId: "id",
        before: { amount: 1 },
        after,
        metadata: { authorization: "Bearer secret" },
      },
      new Headers({ "cf-connecting-ip": "192.0.2.1", "user-agent": "test-agent" }),
    );
    after.name = "Mutated";
    await Promise.all(tasks);
    expect(events[0]).toMatchObject({
      actorId: "operator",
      ipAddress: "192.0.2.1",
      userAgent: "test-agent",
      after: {
        name: "Before later mutation",
        nested: {
          password: "[redacted]",
          accessToken: "[redacted]",
          cookie: "[redacted]",
          otp: "[redacted]",
        },
      },
      metadata: { authorization: "[redacted]" },
    });
    expect(JSON.stringify(events)).not.toContain("sensitive");
    expect(
      load.safeAuditValue([undefined, Number.NaN, () => 0, new Date("2026-01-01T00:00:00Z")]),
    ).toEqual([null, null, null, "2026-01-01T00:00:00.000Z"]);
    expect((load.safeAuditValue("x".repeat(5000)) as string).length).toBeLessThan(4200);
    const circular: unknown[] = [];
    circular.push(circular);
    expect(JSON.stringify(load.safeAuditValue(circular))).toContain("depth limit");
  });
  it("captures actor, parameters, status, timing and exact committed snapshots without recording other operations", () => {
    const { load } = runtime();
    const record = vi.fn();
    const operation = {
      operationId: "updateOrder",
      method: "PATCH",
      path: "/api/orders/{id}",
      action: "order.updated",
      resourceType: "order",
    };
    const request = new Request(
      "https://app.example.test/api/orders/123?search=blue&token=private",
      { method: "PATCH" },
    );
    const recorder = load.beginBusinessAudit(
      request,
      [
        { ...operation, method: "GET" },
        { ...operation, path: "/other" },
        { ...operation, path: "/api/other/{id}" },
        operation,
      ],
      { record },
    );
    recorder.actor("operator");
    recorder.capture({ operationId: "other", before: 0, after: 1, resourceIds: ["other"] });
    recorder.capture({
      operationId: "updateOrder",
      before: [{ id: "123", total: 1 }],
      after: [{ id: "123", total: 2 }],
      resourceIds: ["123"],
    });
    recorder.finish(200);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "operator",
        action: "order.updated",
        resourceId: "123",
        before: [{ id: "123", total: 1 }],
        after: [{ id: "123", total: 2 }],
        metadata: expect.objectContaining({
          params: { id: "123" },
          status: 200,
          durationMs: expect.any(Number),
        }),
      }),
      request.headers,
    );
    load
      .beginBusinessAudit(new Request("https://app.example.test/none"), [operation], { record })
      .finish(404);
    expect(record).toHaveBeenCalledTimes(1);
  });
  it("accepts audit true/false and rejects nonboolean or database-free auditing and platform-table collisions", () => {
    const f = fixture();
    expect(validateNordixConfig(f.config).success).toBe(true);
    f.config.endpoints[0].audit = false;
    expect(validateNordixConfig(f.config).success).toBe(true);
    f.config.endpoints[0].audit = "yes" as never;
    expect(validateNordixConfig(f.config).success).toBe(false);
    f.config.endpoints[0].audit = true;
    f.config.backends[0].persistence = undefined;
    expect(validateNordixConfig(f.config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "AUDIT_PERSISTENCE_REQUIRED" }),
    );
    const collision = targetConfig();
    collision.entities.AuditLogs = {
      ...structuredClone(collision.entities.Customer),
      relations: {},
    };
    expect(validateNordixConfig(collision).diagnostics).toContainEqual(
      expect.objectContaining({ code: "GENERATED_NAME_COLLISION", path: "entities.AuditLogs" }),
    );
  });
  it("compiles audited handlers and the activity UI against real dependency types", async () => {
    const f = fixture();
    const selected = Object.fromEntries(
      Object.entries(f.files).filter(
        ([path]) =>
          path.endsWith(".ts") &&
          !path.endsWith("local-server.ts") &&
          !path.endsWith("schema.config.ts"),
      ),
    );
    expect(await generatedTypeErrors(selected)).toEqual([]);
    const frontend = generateFrontend(f.project, "web").virtualFileSystem.snapshot();
    expect(frontend["apps/web/src/components/iam/administration.tsx"]).toContain('role="tab"');
    expect(frontend["apps/web/src/components/iam/audit-activity.tsx"]).toContain("View details");
  }, 30000);
  it("classifies real auth paths and does not mark OAuth initiation or a two-factor challenge as completed signin", () => {
    const { load } = runtime();
    expect(load.authAuditAction("/sign-in/social", false, { url: "redirect" })).toBeUndefined();
    expect(
      load.authAuditAction("/sign-in/email", false, { twoFactorRedirect: true }),
    ).toBeUndefined();
    expect(load.authAuditAction("/callback/google", true, null)).toBe("auth.signin");
    expect(load.authAuditAction("/sign-in/username", true, {})).toBe("auth.signin");
    expect(load.authAuditAction("/sign-in/email", false, { statusCode: 401 })).toBe(
      "auth.signin_failed",
    );
    expect(load.authAuditAction("/reset-password", false, {})).toBe("auth.password_reset");
    expect(load.authAuditAction("/two-factor/verify-totp", true, {})).toBe(
      "auth.two_factor.verify_totp",
    );
    expect(load.authAuditAction("/get-session", false, {})).toBeUndefined();
  });
  it("records real Better Auth signup, signin, password recovery and signout without logging credentials", async () => {
    const f = fixture();
    const record = vi.fn();
    const load = generatedRuntime(f.files, { "better-auth/api": authApi });
    const plugin = (
      load(`${root}/auth/nordix-audit-plugin.ts`).nordixAuditPlugin as (
        service: Service,
      ) => BetterAuthPlugin
    )({ record });
    let resetUrl = "";
    const auth = betterAuth({
      baseURL: "https://app.example.test",
      secret: "isolated-audit-test-secret-only-32-characters",
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      plugins: [plugin],
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ url }) => {
          resetUrl = url;
        },
      },
      logger: { disabled: true },
    });
    const request = (path: string, body: unknown, cookie = "") =>
      auth.handler(
        new Request(`https://app.example.test/api/auth${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://app.example.test",
            cookie,
          },
          body: JSON.stringify(body),
        }),
      );
    const created = await request("/sign-up/email", {
      name: "Audit user",
      email: "audit@example.test",
      password: "private-password-123",
    });
    expect(created.status).toBe(200);
    const id = (await created.json()).user.id;
    const logged = await request("/sign-in/email", {
      email: "audit@example.test",
      password: "private-password-123",
    });
    expect(logged.status).toBe(200);
    const cookie = logged.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect((await request("/sign-out", {}, cookie)).status).toBe(200);
    expect(record.mock.calls.map(([event]) => event.action)).toEqual([
      "auth.signup",
      "auth.signin",
      "auth.signout",
    ]);
    expect(record.mock.calls[2][0].actorId).toBe(id);
    expect((await request("/request-password-reset", { email: "audit@example.test" })).status).toBe(
      200,
    );
    expect(resetUrl).toContain("reset-password");
    const token =
      new URL(resetUrl).searchParams.get("token") ?? new URL(resetUrl).pathname.split("/").pop();
    expect(
      (await request("/reset-password", { newPassword: "other-private-password-123", token }))
        .status,
    ).toBe(200);
    expect(record.mock.calls.map(([event]) => event.action)).toContain("auth.password_reset");
    expect(JSON.stringify(record.mock.calls)).not.toContain("private-password");
    expect(JSON.stringify(record.mock.calls)).not.toContain(cookie);
  });
});
