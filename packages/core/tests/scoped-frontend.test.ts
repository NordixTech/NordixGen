import { type FetchQueryOptions, QueryClient, QueryObserver } from "@tanstack/query-core";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import { generateFrontend } from "../src/generation/frontend.js";
import { resolveProject } from "../src/project/resolve.js";
import { resolvedFixture } from "./fixtures.js";
import { frontendRuntime } from "./frontend-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";
import { persistenceFixture } from "./persistence-fixture.js";
const root = "apps/web/src";
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const config = persistenceFixture();
  config.endpoints = config.endpoints.filter(
    (operation) => !["withLines", "deleteCustomer"].includes(operation.operationId),
  );
  const list = config.endpoints.find((operation) => operation.operationId === "listInvoices");
  if (!list) throw Error("Missing query fixture");
  list.queryParams.push(
    { name: "extra", type: "json", required: false },
    {
      name: "states",
      field: { entity: "Invoice", field: "state" },
      operator: "in",
      required: false,
    },
  );
  config.backends[0].authorization.roles.push("outsider");
  config.backends[0].authorization.rolePermissions.outsider = [];
  config.backends.push({
    name: "reports",
    repository: "app",
    path: "apps/reports",
    modules: { billing: { architecture: "clean", entities: ["Report"], imports: {}, exports: [] } },
  });
  config.entities.Report = {
    backend: "reports",
    fields: { title: { type: "string", required: true } },
    relations: {},
    timestamps: { createdAt: false, updatedAt: false },
    softDelete: false,
  };
  config.endpoints.push({
    backend: "reports",
    entity: "Report",
    operationId: "listInvoices",
    method: "GET",
    path: "/reports",
    authRequired: false,
  });
  config.frontends[0].connectsTo.push("reports");
  config.frontends[0].access = { mode: "public", backend: "api" };
  return resolvedFixture(config);
}
function runtime() {
  const project = fixture();
  const files = generateFrontend(project, "web").virtualFileSystem.snapshot();
  let current: {
    user: { id: string; role: string; permissions?: readonly string[] } | null;
    isPending: boolean;
  } = {
    user: null,
    isPending: true,
  };
  const fetch = vi.fn(
    async (_url: unknown, _options?: RequestInit) =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const load = frontendRuntime(
    files,
    root,
    {
      zod,
      "@tanstack/react-query": {
        QueryClient,
        useQuery: (options: unknown) => options,
        useMutation: (options: unknown) => options,
        useQueryClient: () => client,
      },
      "@/lib/auth/use-session-view": {
        useSessionView: () => ({
          ...current,
          canAccess: (policy: unknown) => canAccess(current.user, current.isPending, policy),
        }),
      },
    },
    {
      fetch,
      process: {
        env: {
          NEXT_PUBLIC_API_BASE_URL: "https://api.example.test",
          NEXT_PUBLIC_REPORTS_BASE_URL: "https://reports.example.test",
        },
      },
    },
  );
  const canAccess = load(`${root}/lib/auth/permissions.ts`).canAccessOperation as (
    user: typeof current.user,
    pending: boolean,
    policy: unknown,
  ) => boolean;
  const hooks = load(`${root}/lib/api/hooks.ts`) as Record<
    string,
    (input?: unknown) => FetchQueryOptions & { enabled: boolean }
  >;
  const hook = (operation: string, input?: unknown) => {
    const name = project.frontends.web.operationNames[operation];
    return hooks[`use${name[0].toUpperCase()}${name.slice(1)}`](input);
  };
  return {
    project,
    files,
    load,
    fetch,
    client,
    hook,
    setSession: (user: typeof current.user, isPending = false) => {
      current = {
        user: user
          ? { ...user, permissions: project.backends.api.identity.rolePermissions[user.role] ?? [] }
          : null,
        isPending,
      };
    },
  };
}
describe("scoped browser operations, caches and forms", () => {
  it("compiles resolved client/form builders without fabricated request casts", async () => {
    const f = runtime();
    const sources = Object.fromEntries(
      Object.entries(f.files)
        .filter(([name]) => /\/lib\/api\/(types|client|endpoints|forms)\.ts$/.test(name))
        .map(([name, content]) => [name.slice("apps/web/".length), content]),
    );
    expect(
      await generatedTypeErrors(sources, {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      }),
    ).toEqual([]);
    const screen = f.files[`${root}/components/features/customer-screen.tsx`];
    expect(screen).not.toContain("Confirm Delete");
    expect(screen).not.toContain("as unknown as");
  }, 20_000);
  it("scopes keys by backend/module/operation/input and sends JSON filters and abort signals correctly", async () => {
    const f = runtime();
    f.setSession({ id: "user-a", role: "admin" });
    const first = f.hook("api.billing.listInvoices", {
      query: { minimum: 2, page: 1, extra: { flag: true }, states: ["active", "archived"] },
    });
    const second = f.hook("reports.billing.listInvoices", {});
    const changed = f.hook("api.billing.listInvoices", { query: { minimum: 2, page: 2 } });
    expect(first.queryKey.slice(0, 4)).toEqual([
      "nordixgen",
      "api",
      "api.billing",
      "api.billing.listInvoices",
    ]);
    expect(first.queryKey).not.toEqual(second.queryKey);
    expect(first.queryKey).not.toEqual(changed.queryKey);
    await f.client.fetchQuery(first);
    await f.client.fetchQuery(second);
    expect(String(f.fetch.mock.calls[0][0])).toContain("/api/backend/api/api/invoices");
    expect(String(f.fetch.mock.calls[1][0])).toBe("/api/backend/reports/reports");
    expect(f.fetch.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
    const url = new URL(String(f.fetch.mock.calls[0][0]), "https://frontend.test");
    expect(url.searchParams.get("extra")).toBe('{"flag":true}');
    expect(url.searchParams.getAll("states")).toEqual(["active", "archived"]);
    const name = f.project.frontends.web.operationNames["api.billing.listInvoices"];
    await (f.load(`${root}/lib/api/endpoints.ts`)[name] as (input: unknown) => Promise<unknown>)({
      query: { extra: null },
    });
    expect(
      new URL(String(f.fetch.mock.calls[2][0]), "https://frontend.test").searchParams.get("extra"),
    ).toBe("null");
  });
  it("does not start private reads while pending/signed out/denied, while public reads still work", async () => {
    const f = runtime();
    const privateRead = new QueryObserver(f.client, f.hook("api.billing.listInvoices"));
    const stop = privateRead.subscribe(() => {});
    expect(f.hook("api.billing.listInvoices").enabled).toBe(false);
    expect(f.hook("api.customers.listCustomers").enabled).toBe(true);
    expect(f.fetch).not.toHaveBeenCalled();
    f.setSession(null);
    privateRead.setOptions(f.hook("api.billing.listInvoices"));
    expect(f.fetch).not.toHaveBeenCalled();
    f.setSession({ id: "denied", role: "outsider" });
    privateRead.setOptions(f.hook("api.billing.listInvoices"));
    expect(f.fetch).not.toHaveBeenCalled();
    f.setSession({ id: "reader", role: "viewer" });
    privateRead.setOptions(f.hook("api.billing.listInvoices"));
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1));
    stop();
  });
  it("invalidates affected queries without touching another backend or module", async () => {
    const f = runtime();
    f.setSession({ id: "a", role: "admin" });
    const invoice = f.hook("api.billing.listInvoices");
    const reports = f.hook("reports.billing.listInvoices");
    const customers = f.hook("api.customers.listCustomers");
    for (const options of [invoice, reports, customers])
      f.client.setQueryData(options.queryKey, [{ secret: "scoped" }]);
    const mutation = f.hook("api.billing.createInvoice") as unknown as {
      onSettled(): Promise<unknown>;
    };
    await mutation.onSettled();
    expect(f.client.getQueryState(invoice.queryKey)?.isInvalidated).toBe(true);
    expect(f.client.getQueryState(reports.queryKey)?.isInvalidated).toBe(false);
    expect(f.client.getQueryState(customers.queryKey)?.isInvalidated).toBe(false);
  });
  it("isolates account changes and cancels in-flight private work before disposal", async () => {
    const f = runtime();
    const { createSessionQueryCache, sessionCacheIdentity } = f.load(
      `${root}/lib/api/cache.ts`,
    ) as unknown as {
      createSessionQueryCache: () => { client: QueryClient; dispose(): void };
      sessionCacheIdentity: (session: unknown) => string;
    };
    const a = createSessionQueryCache();
    const b = createSessionQueryCache();
    expect(a.client).not.toBe(b.client);
    expect(sessionCacheIdentity({ isPending: false, user: { id: "a", role: "viewer" } })).not.toBe(
      sessionCacheIdentity({ isPending: false, user: { id: "b", role: "viewer" } }),
    );
    expect(sessionCacheIdentity({ isPending: true, user: null })).toBe("pending");
    expect(sessionCacheIdentity({ isPending: false, user: null })).toBe("anonymous");
    let finish: (value: unknown) => void = () => {};
    const waiting = new Promise((resolve) => {
      finish = resolve;
    });
    const key = ["nordixgen", "api", "api.billing", "private", "a"];
    const pending = a.client
      .fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => {
          expect(signal.aborted).toBe(false);
          return waiting;
        },
      })
      .catch(() => undefined);
    a.dispose();
    finish([{ secret: "user-a" }]);
    await pending;
    await vi.waitFor(() => expect(a.client.getQueryCache().getAll()).toHaveLength(0));
    expect(b.client.getQueryData(key)).toBeUndefined();
  });
  it("builds typed aliased mutations with nullable decimals, JSON and ISO dates and validates integer fields", () => {
    const f = runtime();
    const forms = f.load(`${root}/lib/api/forms.ts`) as Record<
      string,
      (...args: unknown[]) => Record<string, unknown>
    >;
    const created = forms.createInvoiceFormInput({
      customerId: id,
      total: "2.50",
      discount: null,
      note: null,
      payload: '{"currency":"EUR"}',
      issuedAt: "2026-10-18T01:00:00.000Z",
    });
    expect(created.body).toMatchObject({
      customerId: id,
      total: 2.5,
      discount: null,
      note: null,
      payload: { currency: "EUR" },
      issuedAt: "2026-10-18T01:00:00.000Z",
    });
    expect(forms.updateInvoiceFormInput({ discount: null }, id)).toEqual({
      path: { invoiceKey: id },
      body: { discount: null },
    });
    expect(forms.deleteInvoiceFormInput({}, id)).toEqual({ path: { invoiceKey: id } });
    expect(() =>
      forms.createLineFormInput({ invoiceId: id, quantity: "1.5", unitPrice: "2" }),
    ).toThrow();
    expect(
      forms.createLineFormInput({ invoiceId: id, quantity: "2", unitPrice: "2.50" }),
    ).toMatchObject({ body: { quantity: 2, unitPrice: 2.5 } });
    expect(() =>
      forms.createInvoiceFormInput({ customerId: id, total: "2", payload: "{invalid" }),
    ).toThrow();
    expect(() =>
      forms.createInvoiceFormInput({ customerId: id, total: "2", payload: "null" }),
    ).toThrow();
    expect(
      forms.createInvoiceFormInput({ customerId: id, total: "2", payload: '"hello"' }),
    ).toMatchObject({ body: { payload: "hello" } });
    expect(forms.formDefaults("createInvoice")).toMatchObject({
      discount: null,
      payload: '{"currency":"USD"}',
    });
    expect(
      forms.formDefaults("updateInvoice", { discount: null, issuedAt: "2026-10-18T01:00:00.000Z" })
        .issuedAt,
    ).toMatch(/^2026-10-1[78]T/);
    expect(() => forms.updateInvoiceFormInput({}, id)).toThrow();
  });
  it("diagnoses ambiguous automatic actions and unavailable record bindings without inventing a route", () => {
    const config = persistenceFixture();
    config.endpoints.push({
      backend: "api",
      entity: "Invoice",
      operationId: "scopedUpdate",
      method: "PATCH",
      path: "/scope/{scope}/invoices/{invoiceKey}",
      pathParams: [
        { name: "scope", type: "string" },
        { name: "invoiceKey", field: { entity: "Invoice", field: "id" } },
      ],
      requestBody: { useCase: { entity: "Invoice", operation: "update" } },
    });
    const result = resolveProject(config);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "FRONTEND_SCREEN_OPERATION_AMBIGUOUS",
    );
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "FRONTEND_SCREEN_BINDING_REQUIRED",
    );
    expect(result.project.frontends.web.features.Invoice.list).toBeUndefined();
    expect(result.project.frontends.web.features.Invoice.update).toBeUndefined();
    const files = generateFrontend(result.project, "web").virtualFileSystem.snapshot();
    expect(files[`${root}/lib/api/endpoints.ts`]).toContain("scopedUpdate");
    expect(files[`${root}/components/features/invoice-screen.tsx`]).not.toContain("updateMutation");
  });
});
