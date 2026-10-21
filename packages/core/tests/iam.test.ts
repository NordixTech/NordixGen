import { once } from "node:events";
import { serve } from "@hono/node-server";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import * as authApi from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

const root = "apps/api/src";
function fixture() {
  const config = targetConfig();
  const project = resolvedFixture(config);
  const output = generateBackend(project, "api");
  if (!output.success) throw Error("Invalid IAM fixture");
  const files = output.virtualFileSystem.snapshot();
  const catalog = new Map([
    [
      "admin",
      { id: "admin", name: "Admin", description: null, isSystem: true, permissions: ["*"] },
    ],
    [
      "viewer",
      {
        id: "viewer",
        name: "Viewer",
        description: null,
        isSystem: true,
        permissions: ["customers:read"],
      },
    ],
  ]);
  let principal: { id: string; role: string; permissions: string[] } | undefined = {
    id: "operator",
    role: "admin",
    permissions: ["*"],
  };
  let signedIn = true;
  const repository = {
    principal: vi.fn(async () => principal),
    roles: vi.fn(async () => [...catalog.values()]),
    users: vi.fn(async () => ({
      items: [{ id: "user", name: "User", email: "user@example.test", role: "viewer" }],
      total: 1,
    })),
    create: vi.fn(
      async (role: {
        id: string;
        name: string;
        description?: string | null;
        permissions: string[];
      }) => {
        if (catalog.has(role.id)) return "conflict";
        catalog.set(role.id, { ...role, description: role.description ?? null, isSystem: false });
        return "ok";
      },
    ),
    change: vi.fn(
      async (change: {
        kind: string;
        id: string;
        role?: string;
        name?: string;
        description?: string | null;
        permissions?: string[];
      }) => {
        const result = { code: "ok", token: "impact-token", selfLoss: [], lost: [], affected: 1 };
        if (change.kind === "user")
          return {
            ...result,
            code: change.id === "user" && catalog.has(change.role ?? "") ? "ok" : "not_found",
          };
        const old = catalog.get(change.id);
        if (!old) return { ...result, code: "not_found" };
        catalog.set(change.id, { ...old, ...change });
        return result;
      },
    ),
    delete: vi.fn(async (id: string) => {
      if (!catalog.has(id) || catalog.get(id)?.isSystem) return "protected";
      catalog.delete(id);
      return "ok";
    }),
  };
  const load = generatedRuntime(files, {
    "better-auth/api": {
      ...authApi,
      sessionMiddleware: authApi.createAuthMiddleware(async () => {
        if (!signedIn)
          throw new authApi.APIError("UNAUTHORIZED", {
            message: "A verified session is required.",
          });
        return { session: { user: { id: "operator" } } };
      }),
    },
    zod,
    [`${root}/platform/audit/store.ts`]: {
      readAudit: async (_connection: unknown, filters: unknown) => ({
        items: [],
        total: 0,
        ...(filters as object),
      }),
    },
    [`${root}/platform/database/drizzle-database.ts`]: { createDrizzleDatabase: () => ({}) },
    [`${root}/platform/authorization/repository.ts`]: { createIamRepository: () => repository },
    [`${root}/platform/authorization/mutations.ts`]: {
      createRole: (_connection: unknown, role: Parameters<typeof repository.create>[0]) =>
        repository.create(role),
      deleteRole: (_connection: unknown, id: string) => repository.delete(id),
      changeAccess: (_connection: unknown, change: Parameters<typeof repository.change>[0]) =>
        repository.change(change),
    },
  });
  const factory = load(`${root}/platform/auth/nordix-iam-plugin.ts`).nordixIamPlugin as (
    config: unknown,
  ) => BetterAuthPlugin;
  const plugin = factory({
    connectionString: "postgresql://unused:unused@unused/unused",
    adminRole: "admin",
    defaultRole: "viewer",
    trustedOrigins: ["https://web.example.test"],
  });
  const app = betterAuth({
    baseURL: "https://web.example.test",
    secret: "isolated-test-secret-only-32-characters",
    trustedOrigins: ["https://web.example.test"],
    plugins: [plugin],
    logger: { disabled: true },
  });
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    origin = "https://web.example.test",
  ) =>
    app.handler(
      new Request(`https://web.example.test/api/auth/iam${path}`, {
        method,
        headers: { origin, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return {
    config,
    project,
    files,
    catalog,
    repository,
    request,
    handler: (request: Request) => app.handler(request),
    setPrincipal: (value: typeof principal) => {
      principal = value;
    },
    signOut: () => {
      signedIn = false;
    },
  };
}
describe("generated dynamic IAM", () => {
  it("deletes a role through real HTTP using the generated frontend client", async () => {
    const f = fixture();
    const server = serve({ fetch: f.handler, hostname: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Missing isolated HTTP test address");
    try {
      const frontend = generateFrontend(f.project, "web").virtualFileSystem.snapshot();
      const source = frontend["apps/web/src/lib/iam/client.ts"];
      const client = generatedRuntime(
        { "client.ts": source },
        {},
        {
          fetch: (path: string, init: RequestInit) =>
            fetch(`http://127.0.0.1:${address.port}${path}`, {
              ...init,
              headers: { ...init.headers, origin: "https://web.example.test" },
            }),
        },
      )("client.ts").iamRequest as (path: string, init?: RequestInit) => Promise<unknown>;
      await client("/roles", {
        method: "POST",
        body: JSON.stringify({ id: "http-role", name: "HTTP role", permissions: [] }),
      });
      expect(f.catalog.has("http-role")).toBe(true);
      await client("/roles/http-role", { method: "DELETE" });
      expect(f.catalog.has("http-role")).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("mounts platform IAM, emits typed capabilities and a protected administration screen", () => {
    const f = fixture();
    expect(f.files[`${root}/index.ts`]).not.toContain('app.all("/api/auth/iam/*"');
    expect(f.files[`${root}/platform/auth/auth.ts`]).toContain("nordixIamPlugin({");
    expect(f.files[`${root}/platform/auth/nordix-iam-plugin.ts`]).toContain(
      'createAuthEndpoint("/iam/roles"',
    );
    expect(Object.values(f.files).join("\n")).not.toContain("auth_iam_audit");
    expect(f.files[`${root}/platform/database/migrate.ts`]).toContain(
      "await seedAuthorization(db)",
    );
    expect(f.files[`${root}/platform/database/schema/auth-schema.ts`]).toContain(
      "references(() => authRoles.id",
    );
    expect(f.files[`${root}/platform/authorization/policy.ts`]).not.toContain("rolePermissions");
    const web = generateFrontend(f.project, "web").virtualFileSystem.snapshot();
    expect(web["apps/web/src/app/admin/roles/page.tsx"]).toContain("await requireIamAccess()");
    expect(web["apps/web/src/lib/auth/permissions.ts"]).not.toContain("rolePermissions");
    expect(web["apps/web/src/components/iam/administration.tsx"]).toContain("manageRoles&&");
    expect(web["apps/web/src/app/page.tsx"]).not.toContain('href="/admin/roles"');
    expect(web["apps/web/src/components/layout/app-shell.tsx"]).toContain(
      'session.hasPermission("iam:roles:manage")||session.hasPermission("iam:users:manage-roles")',
    );
  });
  it("uses the configured administrator role throughout seed, CLI, and IAM protections", () => {
    const config = targetConfig();
    Object.assign(config.backends[0].authorization, {
      roles: ["root-chief", "viewer"],
      adminRole: "root-chief",
      defaultRole: "viewer",
      rolePermissions: { viewer: ["customers:read"] },
    });
    const project = resolvedFixture(config);
    const generated = generateBackend(project, "api");
    expect(generated.success).toBe(true);
    if (!generated.success) return;
    const files = generated.virtualFileSystem.snapshot();
    const seed = files[`${root}/platform/authorization/seed.ts`];
    const provisioning = files[`${root}/platform/authorization/create-admin.ts`];
    const plugin = files[`${root}/platform/auth/auth.ts`];
    expect(seed).toContain(
      '"id":"root-chief","name":"Administrator","isSystem":true,"permissions":["*"]',
    );
    expect(seed).toContain("ON CONFLICT (role_id,permission) DO NOTHING");
    expect(provisioning).toContain('role=${"root-chief"}');
    expect(plugin).toContain('adminRole:"root-chief"');
  });
  it("creates roles, rejects unknown grants, updates metadata/grants and protects defaults and admin", async () => {
    const f = fixture();
    expect(
      (
        await f.request("/roles", "POST", {
          id: "auditor",
          name: "Auditor",
          permissions: ["customers:read"],
        })
      ).status,
    ).toBe(201);
    expect(
      (await f.request("/roles", "POST", { id: "auditor", name: "Auditor", permissions: [] }))
        .status,
    ).toBe(409);
    for (const permissions of [
      ["unregistered:capability"],
      ["*"],
      ["customers:read", "customers:read"],
    ])
      expect(
        (await f.request("/roles", "POST", { id: "bad", name: "Bad", permissions })).status,
      ).toBe(400);
    expect((await f.request("/roles/auditor", "PUT", { name: "Audit team" })).status).toBe(200);
    expect(f.catalog.get("auditor")).toMatchObject({
      name: "Audit team",
      permissions: ["customers:read"],
    });
    expect((await f.request("/roles/auditor", "PUT", { permissions: [] })).status).toBe(200);
    expect((await f.request("/roles/admin", "DELETE")).status).toBe(409);
    expect((await f.request("/roles/viewer", "DELETE")).status).toBe(409);
    expect((await f.request("/roles/auditor", "DELETE")).status).toBe(204);

    expect((await f.request("/roles/missing", "PUT", {})).status).toBe(400);
  });
  it("separates user role assignment from role editing and exposes only minimal role options", async () => {
    const f = fixture();
    f.setPrincipal({ id: "hr", role: "hr", permissions: ["iam:users:manage-roles"] });
    const options = await f.request("/role-options");
    expect(options.status).toBe(200);
    expect(await options.json()).toEqual([
      { id: "admin", name: "Admin" },
      { id: "viewer", name: "Viewer" },
    ]);
    expect((await f.request("/users?page=1&pageSize=10")).status).toBe(200);
    expect(f.repository.users).toHaveBeenCalledWith(10, 0);
    expect((await f.request("/users?pageSize=101")).status).toBe(400);
    expect((await f.request("/users/user/role", "POST", { role: "admin" })).status).toBe(200);
    expect((await f.request("/users/user/role", "POST", { role: "missing" })).status).toBe(404);
    expect(
      (await f.request("/users/user/role", "POST", { role: "admin", extra: true })).status,
    ).toBe(400);
    for (const path of ["/roles", "/permissions"]) expect((await f.request(path)).status).toBe(403);
    for (const [path, method] of [
      ["/roles", "POST"],
      ["/roles/admin", "PUT"],
      ["/roles/admin", "DELETE"],
    ])
      expect(
        (
          await f.request(
            path,
            method,
            method === "POST"
              ? { id: "test-role", name: "Test", permissions: [] }
              : { name: "Updated" },
          )
        ).status,
      ).toBe(403);
    f.setPrincipal({ id: "roles", role: "roles", permissions: ["iam:roles:manage"] });
    for (const path of ["/role-options", "/users"])
      expect((await f.request(path)).status).toBe(403);
    expect((await f.request("/users/user/role", "POST", { role: "admin" })).status).toBe(403);
  });
  it("returns reviewable impact and non-overridable last-administrator conflicts", async () => {
    const f = fixture();
    for (const [code, status] of [
      ["confirmation_required", 409],
      ["last_admin", 409],
      ["forbidden", 403],
      ["protected", 400],
      ["not_found", 404],
    ] as const) {
      f.repository.change.mockResolvedValueOnce({
        code,
        token: "impact-token",
        selfLoss: ["iam:users:manage-roles"],
        lost: ["iam:users:manage-roles"],
        affected: 1,
      } as never);
      const response = await f.request("/users/user/role", "POST", {
        role: "viewer",
        confirmation: "previous-impact",
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, token: "impact-token" });
    }
    expect((await f.request("/audit")).status).toBe(200);
    f.setPrincipal({ id: "hr", role: "hr", permissions: ["iam:users:manage-roles"] });
    expect((await f.request("/audit")).status).toBe(403);
  });
  it("checks verified sessions, current grants and mutation origin before writes", async () => {
    const f = fixture();
    expect((await f.request("/me")).headers.get("cache-control")).toBe("no-store");
    expect(
      (
        await f.request(
          "/roles",
          "POST",
          { id: "bad", name: "Bad", permissions: [] },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(f.repository.create).not.toHaveBeenCalled();
    f.setPrincipal({ id: "operator", role: "custom", permissions: [] });
    expect((await f.request("/roles")).status).toBe(403);
    f.setPrincipal(undefined);
    expect((await f.request("/me")).status).toBe(403);
    f.signOut();
    expect((await f.request("/roles")).status).toBe(401);
    const failed = fixture();
    failed.repository.roles.mockRejectedValueOnce(Error("private-database-details"));
    const failure = await failed.request("/roles");
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain("private-database-details");
  });
  it("rejects privileged signup defaults, unknown seed permissions, business role locks and platform collisions", () => {
    for (const grant of ["*", "iam:roles:manage", "iam:users:manage-roles"]) {
      const f = fixture();
      f.config.backends[0].authorization.rolePermissions.viewer = [grant];
      expect(validateNordixConfig(f.config).diagnostics).toContainEqual(
        expect.objectContaining({ code: "DEFAULT_ROLE_PRIVILEGED" }),
      );
    }
    const f = fixture();
    f.config.backends[0].authorization.defaultRole = "admin";
    expect(validateNordixConfig(f.config).success).toBe(false);
    f.config.backends[0].authorization.defaultRole = "viewer";
    f.config.backends[0].authorization.rolePermissions.admin = ["not:declared"];
    expect(validateNordixConfig(f.config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "PERMISSION_UNKNOWN" }),
    );
    f.config.endpoints[0].roles = ["admin"];
    f.config.endpoints[0].path = "/api/auth/iam/roles";
    const codes = validateNordixConfig(f.config).diagnostics.map((d) => d.code);
    expect(codes).toContain("ENDPOINT_ROLES_REMOVED");
    expect(codes).toContain("PLATFORM_ROUTE_RESERVED");
  });
  it("registers operation capabilities without requiring any initial role grant", () => {
    const config = targetConfig();
    config.endpoints[1].permissions.push("customers:archive");
    expect(validateNordixConfig(config).success).toBe(true);
    expect(resolvedFixture(config).backends.api.identity?.permissions).toContain(
      "customers:archive",
    );
    config.entities.AuthRoles = { ...structuredClone(config.entities.Customer), relations: {} };
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "GENERATED_NAME_COLLISION", path: "entities.AuthRoles" }),
    );
  });
});
