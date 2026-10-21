import { posix } from "node:path";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import { generateBackend } from "../src/generation/backend.js";
import { resolveArchitectureLayout } from "../src/plugins/architecture/layout.js";
import type { ResolvedModule } from "../src/project/types.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";
const root = "apps/api/src";
const id = "11111111-1111-4111-8111-111111111111";
const authoredPreview = `import type {ModuleDependencies} from "./ports/module-dependencies.js";
import type {GetCustomerInput} from "../../customers/index.js";
import type {OperationContext,ApplicationResult} from "../../../platform/application/contracts.js";
import type {AccessGuard} from "../../../platform/application/access.js";
// Deliberately authored fixture logic. The import declaration does not generate this workflow.
export class PreviewCustomer {
 constructor(private readonly dependencies:ModuleDependencies,private readonly authorize:AccessGuard){}
 async execute(input:GetCustomerInput,context:OperationContext):Promise<ApplicationResult<{customer:string}>> {
  const denied=this.authorize(context,{authenticated:true,roles:[],permissions:["invoices:read"]});if(denied)return {ok:false,error:denied};
  const result=await this.dependencies.customers.getCustomer(input,context);if(!result.ok)return result;
  const customer=result.value[0];if(!customer)return {ok:false,error:{code:"not_found",message:"Customer is unavailable."}};
  return {ok:true,value:{customer:customer.entity.name}};
 }
}`;
interface TestContext {
  readonly principal: { readonly id: string; readonly role: string } | null;
}
interface TestError {
  readonly code: string;
  readonly message: string;
}
type TestResult = { ok: true; value: unknown } | { ok: false; error: TestError };
type TestOperation = (input: unknown, context: TestContext) => Promise<TestResult>;
type TestGuard = (
  context: TestContext,
  policy: { authenticated: boolean; roles: readonly string[]; permissions: readonly string[] },
) => TestError | undefined;
interface TestBoundary {
  authorize: TestGuard;
  run<T>(headers: Headers, callback: (context: TestContext) => Promise<T>): Promise<T>;
}
interface TestModule {
  public: Record<string, TestOperation>;
  operations: Record<string, TestOperation>;
  dependencies: Record<string, Record<string, TestOperation>>;
}
interface TestComposition {
  composeModules(db: unknown, authorize: TestGuard): Record<string, TestModule>;
  createRouteDependencies(
    url: string,
    boundary: TestBoundary,
    headers: Headers,
  ): { endpoints: Record<string, { useCase: { execute(input: unknown): Promise<unknown> } }> };
}
interface ErrorModule {
  ApplicationFailure: new (error: TestError) => Error;
}
function makeFixture(
  producer: ResolvedModule["architecture"],
  consumer: ResolvedModule["architecture"],
) {
  const config = targetConfig();
  config.backends[0].modules.customers.architecture = producer;
  config.backends[0].modules.billing.architecture = consumer;
  const applicationRoot = resolveArchitectureLayout(consumer).applicationRoot;
  const previewPath = `${root}/modules/billing/${applicationRoot}/preview-customer.ts`;
  const relative = (target: string) => {
    const path = posix.relative(posix.dirname(previewPath), target);
    return path.startsWith(".") ? path : `./${path}`;
  };
  Object.assign(config.backends[0].authorization, {
    roles: ["admin", "viewer", "auditor", "accountant"],
    rolePermissions: {
      viewer: ["customers:read", "invoices:read"],
      auditor: ["customers:read"],
      accountant: ["invoices:read"],
    },
  });
  const project = resolvedFixture(config);
  const result = generateBackend(project, "api");
  if (!result.success) throw Error(JSON.stringify(result.diagnostics));
  const files = {
    ...result.virtualFileSystem.snapshot(),
    [previewPath]: authoredPreview
      .replace("../../customers/index.js", relative(`${root}/modules/customers/index.js`))
      .replace(
        "../../../platform/application/contracts.js",
        relative(`${root}/platform/application/contracts.js`),
      )
      .replace(
        "../../../platform/application/access.js",
        relative(`${root}/platform/application/access.js`),
      ),
  };
  const customer = {
    id,
    name: "Ada",
    email: "ada@example.test",
    createdAt: new Date("2025-01-01Z"),
    updatedAt: new Date("2025-01-01Z"),
    deletedAt: null,
    addresses: [],
  };
  const find = vi.fn(async () => [customer]);
  const db = {
    query: { CustomerTable: { findMany: find }, InvoiceTable: { findMany: async () => [] } },
    select: () => ({ from: () => ({ where: async () => [{ count: 1 }] }) }),
  };
  const load = generatedRuntime(files, {
    zod,
    "drizzle-orm": orm,
    "drizzle-orm/pg-core": pg,
    [`${root}/platform/database/drizzle-database.ts`]: { createDrizzleDatabase: () => db },
  });
  const { createOperationBoundary } = load(`${root}/platform/application/access.ts`) as unknown as {
    createOperationBoundary: (
      verify: (headers: Headers) => Promise<TestContext["principal"]>,
    ) => TestBoundary;
  };
  const verifySession = vi.fn(async (headers: Headers) => {
    const role = headers.get("x-fixture-verified-role");
    return role
      ? {
          id: "server-user",
          role,
          permissions:
            role === config.backends[0].authorization.adminRole
              ? ["*"]
              : (config.backends[0].authorization.rolePermissions[role] ?? []),
        }
      : null;
  });
  const boundary = createOperationBoundary(verifySession);
  const { composeModules, createRouteDependencies } = load(
    `${root}/platform/database/create-route-dependencies.ts`,
  ) as unknown as TestComposition;
  const modules = composeModules(db, boundary.authorize);
  const { PreviewCustomer } = load(previewPath) as unknown as {
    PreviewCustomer: new (
      dependencies: TestModule["dependencies"],
      authorize: TestGuard,
    ) => { execute: TestOperation };
  };
  const preview = new PreviewCustomer(modules.billing.dependencies, boundary.authorize);
  const headers = (role?: string) => new Headers(role ? { "x-fixture-verified-role": role } : {});
  return {
    files,
    load,
    modules,
    boundary,
    preview,
    headers,
    find,
    verifySession,
    createRouteDependencies,
  };
}
describe.each([
  ["clean", "clean"],
  ["clean", "hexagonal"],
  ["hexagonal", "clean"],
  ["clean", "onion"],
  ["onion", "clean"],
  ["hexagonal", "onion"],
] as const)("%s producer / %s consumer", (producer, consumer) => {
  const fixture = () => makeFixture(producer, consumer);
  describe("typed public application communication", () => {
    it("compiles generated public contracts, imports and an explicit authored two-module use case", async () => {
      const { files } = fixture();
      const sources = Object.fromEntries(
        Object.entries(files)
          .filter(([path]) => path.endsWith(".ts"))
          .map(([path, content]) => [path.slice("apps/api/".length), content]),
      );
      sources["public-contract-types.ts"] =
        `import type {PublicApi,GetCustomerOutput} from "./src/modules/customers/index.js";
import type {OperationContext} from "./src/platform/application/contracts.js";
declare const api:PublicApi;declare const context:OperationContext;declare const row:GetCustomerOutput[number];
const instant:Date=row.entity.createdAt;
// @ts-expect-error public inputs are flat application values
api.getCustomer({path:{customerId:"id"}},context);
// @ts-expect-error only declared operations are public
api.createCustomer({},context);
// @ts-expect-error request context cannot be fabricated from JSON principal data
const forged:OperationContext={principal:{id:"browser",role:"admin"}};
// @ts-expect-error context principal is immutable
context.principal!.role="admin";
// @ts-expect-error application dates are Date values, not HTTP strings
const wire:string=row.entity.createdAt;
`;
      expect(await generatedTypeErrors(sources)).toEqual([]);
      const entry = files[`${root}/modules/customers/index.ts`];
      expect(entry).toContain("GetCustomerInput");
      expect(entry).not.toMatch(/repository|drizzle|domain|controller/);
      const dependencies =
        files[
          `${root}/modules/billing/${resolveArchitectureLayout(consumer).applicationRoot}/ports/module-dependencies.ts`
        ];
      expect(dependencies).toContain('"getCustomer"');
      expect(dependencies).not.toContain('"createCustomer"');
    }, 20_000);
    it("wires only declared public operations and executes real calls with the same context", async () => {
      const f = fixture();
      expect(Object.keys(f.modules.customers.public)).toEqual(["getCustomer"]);
      expect(Object.keys(f.modules.billing.dependencies.customers)).toEqual(["getCustomer"]);
      const result = await f.boundary.run(f.headers("viewer"), (context) =>
        f.preview.execute({ customerId: id }, context),
      );
      expect(result).toEqual({ ok: true, value: { customer: "Ada" } });
      expect(f.find).toHaveBeenCalledOnce();
    });
    it.each([
      [undefined, "unauthorized"],
      ["auditor", "forbidden"],
      ["accountant", "forbidden"],
    ])("enforces independent caller and callee access for %s", async (role, code) => {
      const f = fixture();
      expect(
        await f.boundary.run(f.headers(role), (context) =>
          f.preview.execute({ customerId: id }, context),
        ),
      ).toMatchObject({ ok: false, error: { code } });
      expect(f.find).not.toHaveBeenCalled();
    });
    it("rejects forged, changed and expired contexts, while wildcard grants work", async () => {
      const f = fixture();
      const fake = { principal: { id: "browser", role: "admin" } };
      expect(await f.modules.customers.public.getCustomer({ customerId: id }, fake)).toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
      let previous: TestContext | undefined;
      await f.boundary.run(f.headers("admin"), async (context) => {
        previous = context;
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.principal)).toBe(true);
        if (!context.principal) throw new Error("Missing verified test principal");
        expect(() => Object.assign(context.principal, { role: "admin" })).toThrow();
        expect(await f.preview.execute({ customerId: id }, context)).toMatchObject({ ok: true });
      });
      if (!previous) throw new Error("Missing issued test context");
      expect(
        await f.modules.customers.public.getCustomer({ customerId: id }, previous),
      ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    });
    it("preserves validation, ordinary empty results, authored not-found and safe failures", async () => {
      const f = fixture();
      const run = (input: unknown) =>
        f.boundary.run(f.headers("viewer"), (context) =>
          f.modules.customers.public.getCustomer(input, context),
        );
      expect(await run({ customerId: "invalid" })).toMatchObject({
        ok: false,
        error: { code: "validation" },
      });
      expect(await run({ customerId: id, role: "admin" })).toMatchObject({
        ok: false,
        error: { code: "validation" },
      });
      f.find.mockResolvedValueOnce([]);
      expect(await run({ customerId: id })).toEqual({ ok: true, value: [] });
      f.find.mockResolvedValueOnce([]);
      expect(
        await f.boundary.run(f.headers("viewer"), (context) =>
          f.preview.execute({ customerId: id }, context),
        ),
      ).toMatchObject({ ok: false, error: { code: "not_found" } });
      f.find.mockRejectedValueOnce(Error("postgres://private-secret/SQL exception"));
      const result = await run({ customerId: id });
      expect(result).toMatchObject({ ok: false, error: { code: "unexpected" } });
      expect(JSON.stringify(result)).not.toContain("private-secret");
    });
    it("bridges application failures to HTTP without leaking ORM or response objects into module contracts", async () => {
      const f = fixture();
      const deps = f.createRouteDependencies("unused", f.boundary, f.headers("viewer"));
      expect(await deps.endpoints.getCustomer.useCase.execute({ customerId: id })).toMatchObject([
        { entity: { name: "Ada" } },
      ]);
      const { ApplicationFailure } = f.load(
        `${root}/platform/application/contracts.ts`,
      ) as unknown as ErrorModule;
      const { applicationProblem } = f.load(
        `${root}/platform/http/application-error.ts`,
      ) as unknown as {
        applicationProblem: (context: unknown, error: unknown) => Response | undefined;
      };
      const context = {
        req: { path: "/test" },
        json: (body: unknown, status: number, headers: HeadersInit) =>
          new Response(JSON.stringify(body), { status, headers }),
      };
      for (const [code, status] of [
        ["validation", 400],
        ["unauthorized", 401],
        ["forbidden", 403],
        ["not_found", 404],
        ["conflict", 409],
        ["unexpected", 500],
      ]) {
        const response = applicationProblem(
          context,
          new ApplicationFailure({
            code,
            message: code === "unexpected" ? "private-secret" : "Safe application failure",
          }),
        );
        if (!response) throw new Error("Missing application HTTP error mapping");
        expect(response.status).toBe(status);
        expect(await response.text()).not.toContain("private-secret");
      }
      expect(applicationProblem(context, Error("unrecognized"))).toBeUndefined();
      await expect(
        f
          .createRouteDependencies("unused", f.boundary, f.headers())
          .endpoints.getCustomer.useCase.execute({ customerId: id }),
      ).rejects.toThrow("verified session");
    });
  });

  describe("anonymous application calls and transaction limits", () => {
    it("permits public operations only with an issued anonymous context", async () => {
      const f = fixture();
      expect(
        await f.boundary.run(f.headers(), (context) =>
          f.modules.customers.operations.listCustomers({}, context),
        ),
      ).toMatchObject({ ok: true, value: { total: 1 } });
      expect(
        await f.modules.customers.operations.listCustomers({}, { principal: null }),
      ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    });
    it("propagates deliberate application failures and contains unexpected private messages", async () => {
      const f = fixture();
      const { ApplicationFailure } = f.load(
        `${root}/platform/application/contracts.ts`,
      ) as unknown as ErrorModule;
      for (const code of ["conflict", "unexpected"]) {
        f.find.mockRejectedValueOnce(
          new ApplicationFailure({
            code,
            message: code === "unexpected" ? "private-secret" : "Known conflict",
          }),
        );
        const result = await f.boundary.run(f.headers("viewer"), (context) =>
          f.modules.customers.public.getCustomer({ customerId: id }, context),
        );
        expect(result).toMatchObject({ ok: false, error: { code } });
        expect(JSON.stringify(result)).not.toContain("private-secret");
      }
    });
    it("does not roll back an explicit caller side effect after a callee denial", async () => {
      const f = fixture();
      const effects: string[] = [];
      const result = await f.boundary.run(f.headers("accountant"), async (context) => {
        effects.push("authored caller write");
        return f.modules.billing.dependencies.customers.getCustomer({ customerId: id }, context);
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(effects).toEqual(["authored caller write"]);
    });
  });

  describe("application contracts without persistence", () => {
    it("typechecks a domain-only module without introducing a database or identity runtime", async () => {
      const config = targetConfig("single-module");
      config.backends[0].persistence = undefined;
      config.endpoints = [];
      const output = generateBackend(resolvedFixture(config), "api");
      if (!output.success) throw Error("Invalid nonpersistent fixture");
      const files = output.virtualFileSystem.snapshot();
      expect(
        await generatedTypeErrors(
          Object.fromEntries(
            Object.entries(files)
              .filter(([path]) => path.endsWith(".ts"))
              .map(([path, content]) => [path.slice("apps/api/".length), content]),
          ),
        ),
      ).toEqual([]);
      expect(
        Object.keys(files).some(
          (path) => path.endsWith("/auth.ts") || path.endsWith("/drizzle-database.ts"),
        ),
      ).toBe(false);
    }, 20_000);
  });
});
