import ts from "typescript";
import { describe, expect, it } from "vitest";
import { frontendRenderContext, generateFrontend } from "../src/generation/frontend.js";
import { generateFrontendAuthFiles } from "../src/plugins/frontends/better-auth-client.js";
import { generateApiClientFiles } from "../src/plugins/frontends/typed-api-client.js";
import { createSecuredConfig, createValidConfig, resolvedFixture } from "./fixtures.js";
import { generatedTypeErrors } from "./generated-types.js";
function apiConfiguration() {
  return {
    schemaVersion: 2,
    name: "shop",
    version: "1.0.0",
    repositories: [{ name: "commerce", path: "." }],
    backends: [
      {
        name: "api",
        repository: "commerce",
        path: "apps/api",
        modules: { orders: { architecture: "clean", entities: ["Order", "User"] } },
      },
    ],
    frontends: [
      { name: "store-web", repository: "commerce", path: "apps/store-web", connectsTo: ["api"] },
    ],
    enums: { OrderStatus: ["pending", "paid"] },
    entities: {
      Order: {
        backend: "api",
        fields: { status: { type: "enum", enumName: "OrderStatus" } },
        relations: { user: { target: "User", type: "many-to-one" } },
      },
      User: { backend: "api", fields: { name: { type: "string" } } },
    },
    pagination: { standard: { defaultPageSize: 20, maxPageSize: 100 } },
    endpoints: [
      {
        backend: "api",
        path: "/orders/{orderId}",
        method: "GET",
        operationId: "getOrder",
        entity: "Order",
        queryParams: [{ name: "includeLines", type: "boolean", required: false }],
        pathParams: [{ name: "orderId", field: { entity: "Order", field: "id" } }],
      },
      {
        backend: "api",
        path: "/orders",
        method: "GET",
        operationId: "listOrders",
        entity: "Order",
        queryParams: [
          { name: "status", field: { entity: "Order", field: "status" }, required: false },
        ],
        joins: [{ entity: "User", type: "left", fields: ["name"] }],
        pagination: "standard",
      },
      {
        backend: "api",
        path: "/users/{id}",
        method: "PATCH",
        operationId: "updateUser",
        entity: "User",
        pathParams: [{ name: "id", field: { entity: "User", field: "id" } }],
        requestBody: { useCase: { entity: "User", operation: "update" } },
      },
    ],
  };
}
describe("fixed frontend contracts", () => {
  it("typechecks emitted clients and explorer with required nullable JSON response fields", async () => {
    const config = apiConfiguration();
    Object.assign(config.entities.Order.fields, {
      publishedAt: { type: "date", required: false },
      metadata: { type: "json", required: false },
    });
    config.endpoints.push({
      backend: "api",
      entity: "Order",
      method: "POST",
      path: "/orders/custom",
      operationId: "customOrder",
      requestBody: { date: { field: { entity: "Order", field: "publishedAt" }, required: true } },
    });
    const project = resolvedFixture(config);
    const output = generateApiClientFiles(frontendRenderContext(project, "store-web"));
    const files = Object.fromEntries(
      output
        .filter(
          (file) => file.path.includes("/lib/api/") || file.path.endsWith("/api-explorer.tsx"),
        )
        .map((file) => [file.path.split("/src/")[1], file.content]),
    );
    const errors = await generatedTypeErrors(
      files,
      { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
      {
        "framework.d.ts": `declare namespace JSX { interface Element {} interface IntrinsicElements { [tag: string]: { children?: unknown; onChange?: (event: {target: {value: string}}) => void; [key: string]: unknown } } }
declare module "react" {
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  export function useState<T = undefined>(): [T | undefined, (value: T | undefined) => void];
  export function useMemo<T>(factory: () => T, dependencies: unknown[]): T;
}
declare module "@/components/ui/button" { export function Button(props: Record<string, unknown>): JSX.Element; }
declare module "@/components/ui/notice" { export function Notice(props: Record<string, unknown>): JSX.Element; }`,
        "wire-contract.ts": `import type { OrderResponse, customOrderBody } from "./lib/api/types.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const date: Assert<Equal<OrderResponse["publishedAt"], string | null>> = true;
const present: Assert<Equal<{} extends Pick<OrderResponse, "publishedAt"> ? false : true, true>> = true;
const body: Assert<Equal<customOrderBody["date"], string | null>> = true;
// @ts-expect-error HTTP dates are JSON strings, not application Date objects.
const invalid: OrderResponse["publishedAt"] = new Date();
void [date, present, body, invalid];`,
      },
    );
    expect(errors).toEqual([]);
  }, 15_000);
});

describe("fixed UI assembly and declared features", () => {
  it.each([false, "boolean", "timestamp"] as const)(
    "generates declared CRUD, forms, filtering and pagination for %s deletion",
    (softDelete) => {
      const config = createSecuredConfig();
      config.entities.Customer.softDelete = softDelete;
      Object.assign(config.entities.Customer.fields, {
        name: { type: "string", maxLength: 30 },
        age: { type: "number", format: "integer", required: false },
        enabled: { type: "boolean" },
        birthday: { type: "date", required: false },
        metadata: { type: "json", required: false },
        reference: { type: "uuid", required: false },
      });
      config.endpoints.push(
        {
          backend: "core-api",
          entity: "Customer",
          operationId: "listCustomers",
          method: "GET",
          path: "/customers",
          pagination: "standard",
          queryParams: [
            {
              name: "search",
              field: { entity: "Customer", field: "name" },
              operator: "contains",
              required: false,
            },
          ],
        },
        {
          backend: "core-api",
          entity: "Customer",
          operationId: "createCustomer",
          method: "POST",
          path: "/customers",
          requestBody: { useCase: { entity: "Customer", operation: "create" } },
        },
        {
          backend: "core-api",
          entity: "Customer",
          operationId: "updateCustomer",
          method: "PATCH",
          path: "/customers/{customerId}",
          pathParams: [{ name: "customerId", field: { entity: "Customer", field: "id" } }],
          requestBody: { useCase: { entity: "Customer", operation: "update" } },
        },
        {
          backend: "core-api",
          entity: "Customer",
          operationId: "deleteCustomer",
          method: "DELETE",
          path: "/customers/{customerId}",
          pathParams: [{ name: "customerId", field: { entity: "Customer", field: "id" } }],
        },
      );
      const project = resolvedFixture(config);
      const result = generateFrontend(project, "store-web");
      const files = result.virtualFileSystem.snapshot();
      const root = "apps/store-web/src";
      const screen = files[`${root}/components/features/customer-screen.tsx`];
      expect(screen).toContain("useListCustomers");
      expect(screen).toContain("mutateAsync");
      expect(screen).toContain("searchFilter");
      expect(screen).toContain("setPage");
      expect(screen).toContain("zodResolver");
      expect(files[`${root}/lib/api/hooks.ts`]).toContain("invalidateQueries");
      const providers = files[`${root}/app/providers.tsx`];
      expect(providers.split("function Providers")).toHaveLength(2);
      expect(providers).toContain("QueryClientProvider");
      expect(providers).not.toContain("SessionViewSync");
      expect(files[`${root}/stores/auth-store.ts`]).toBeUndefined();
      expect(files[`${root}/stores/ui-store.ts`]).toContain("zustand");
      expect(files[`${root}/components/auth/sign-in-form.tsx`]).toContain("signIn");
      const all = Object.values(files).join("\n");
      expect(all).not.toMatch(/useSWR|ClientStateProvider/);
      expect(result.runtimeDependencies).not.toHaveProperty("swr");
      expect(generateFrontend(project, "store-web").virtualFileSystem.snapshot()).toEqual(files);
    },
  );
  it("always emits Query/Zustand shell without requiring business endpoints or authentication", () => {
    const config = createValidConfig();
    config.endpoints = [];
    const result = generateFrontend(resolvedFixture(config), "store-web");
    const files = result.virtualFileSystem.snapshot();
    const root = "apps/store-web/src";
    expect(files[`${root}/app/providers.tsx`]).toContain("QueryClientProvider");
    expect(files[`${root}/app/providers.tsx`]).not.toContain("SessionViewSync");
    expect(files[`${root}/lib/api/client.ts`]).toContain("NEXT_PUBLIC_API_BASE_URL");
    expect(files[`${root}/app/api-explorer/page.tsx`]).toBeUndefined();
    expect(files[`${root}/lib/auth/client.ts`]).toBeUndefined();
    expect(result.frameworkContext.scaffold.argumentsBeforeTarget).toContain(
      "create-next-app@15.5.26",
    );
    expect(result.frameworkContext.scaffold.argumentsAfterTarget).toContain("--tailwind");
  });
  it("generates supported identity options and denies absent identity at the renderer boundary", () => {
    const config = createSecuredConfig();
    Object.assign(config.backends[0].authentication, {
      methods: ["email-password", "username-password"],
      identityProviders: ["google", "github"],
      features: ["two-factor", "password-recovery", "email-verification"],
    });
    const result = generateFrontend(resolvedFixture(config), "store-web");
    const files = result.virtualFileSystem.snapshot();
    expect(Object.values(files).join("\n")).toContain("twoFactorClient");
    expect(Object.values(files).join("\n")).toContain("Password (at least 12 characters)");
    expect(Object.values(files).join("\n")).toContain("minLength={12}");
    expect(() =>
      generateFrontendAuthFiles(frontendRenderContext(resolvedFixture(), "store-web")),
    ).toThrow(/identity/);
  });
});

describe("frontend contract edge cases", () => {
  it("keeps inline bodies, empty create inputs and empty projections explicit", () => {
    const config = apiConfiguration();
    config.entities.EmptyRecord = { backend: "api", fields: {} };
    config.backends[0].modules.orders.entities.push("EmptyRecord");
    config.endpoints[1].joins[0].fields = [];
    config.endpoints[1].pagination = undefined;
    config.endpoints.push(
      {
        backend: "api",
        entity: "EmptyRecord",
        operationId: "createEmpty",
        method: "POST",
        path: "/empty",
        requestBody: { useCase: { entity: "EmptyRecord", operation: "create" } },
      },
      {
        backend: "api",
        entity: "Order",
        operationId: "showExamples",
        method: "POST",
        path: "/examples",
        requestBody: {
          count: { type: "number" },
          active: { type: "boolean" },
          details: { type: "json" },
          status: { type: "enum", enumName: "OrderStatus" },
          title: { type: "string", default: "Draft" },
          when: { type: "date", default: { kind: "now" } },
        },
      },
    );
    const files = generateFrontend(
      resolvedFixture(config),
      "store-web",
    ).virtualFileSystem.snapshot();
    const root = "apps/store-web/src";
    expect(files[`${root}/lib/api/types.ts`]).toContain(
      "export type createEmptyBody = Record<string, never>",
    );
    expect(files[`${root}/lib/api/types.ts`]).toContain('"User": {  } | null');
    const explorer = Object.entries(files).find(([path]) =>
      path.endsWith("/api-explorer.tsx"),
    )?.[1];
    for (const pair of [
      '"count": 0',
      '"active": false',
      '"details": {}',
      '"status": "pending"',
      '"title": "Draft"',
    ])
      expect(explorer).toContain(pair);
    expect(explorer).not.toContain('"kind": "now"');
    expect(files[`${root}/components/features/user-screen.tsx`]).toContain("data: []");
  });
  it.each([false, true])(
    "derives schemas for defaulted and nullable form values with access requirements %s",
    (nullable) => {
      const config = createSecuredConfig();
      const fields = {
        name: { type: "string", required: !nullable, default: nullable ? null : "Draft" },
        score: { type: "number", default: 4, required: !nullable },
        active: { type: "boolean", default: true, required: !nullable },
        metadata: { type: "json", required: !nullable, default: {} },
        role: { type: "enum", enumName: "CustomerRole", required: !nullable, default: "CUSTOMER" },
      };
      Object.assign(config.entities.Customer.fields, fields);
      config.endpoints = [
        {
          backend: "core-api",
          entity: "Customer",
          operationId: "createCustomer",
          method: "POST",
          path: "/customers",
          roles: ["admin"],
          permissions: [],
          requestBody: { useCase: { entity: "Customer", operation: "create" } },
        },
      ];
      const files = generateFrontend(
        resolvedFixture(config),
        "store-web",
      ).virtualFileSystem.snapshot();
      const screen = files["apps/store-web/src/components/features/customer-screen.tsx"];
      expect(screen).toContain(".default(");
      expect(screen).toContain("hasRole");
      expect(screen).toContain("createMutation");
    },
  );
});

describe("presentation access requirements", () => {
  it.each([{ roles: [] }, { roles: ["admin"] }])(
    "requires configured permissions with roles %j",
    ({ roles }) => {
      const config = createSecuredConfig();
      config.endpoints = [
        {
          backend: "core-api",
          entity: "Customer",
          operationId: "createCustomer",
          method: "POST",
          path: "/customers",
          roles,
          permissions: ["orders:create"],
          requestBody: { useCase: { entity: "Customer", operation: "create" } },
        },
      ];
      const files = generateFrontend(
        resolvedFixture(config),
        "store-web",
      ).virtualFileSystem.snapshot();
      expect(files["apps/store-web/src/components/features/customer-screen.tsx"]).toContain(
        "hasPermission(permission)",
      );
    },
  );
});
