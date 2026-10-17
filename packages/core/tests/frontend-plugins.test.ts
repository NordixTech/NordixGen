import { describe, expect, it } from "vitest";
import { FrontendSchema, NordixConfigSchema } from "../src/configuration/schema.js";
import {
  type FrontendGeneratorPlugin,
  FrontendPluginRegistrationError,
  FrontendPluginRegistry,
  betterAuthFrontendPlugin,
  buildFrontendApiContract,
  composeFrontendPlugins,
  contextClientStatePlugin,
  featureScreensFrontendPlugin,
  nativeReactUiPlugin,
  nextjsFrontendPlugin,
  plainCssStylingPlugin,
  swrServerStatePlugin,
  tailwindStylingPlugin,
  tanstackQueryServerStatePlugin,
  typedFetchApiPlugin,
  validateFrontendPluginDescriptor,
  zustandClientStatePlugin,
} from "../src/index.js";
import { getFrontendOperationNames } from "../src/plugins/frontend-operation-names.js";
import {
  generateFeatureScreenFiles,
  groupEndpointsByEntity,
} from "../src/plugins/frontends/feature-screens.js";
import { frontendRootShellOwnerRole } from "../src/plugins/frontends/root-shell.js";

const frontend = (options: Record<string, unknown> = {}) =>
  FrontendSchema.parse({
    name: "store-web",
    framework: "nextjs",
    path: "apps/store-web",
    repository: "commerce",
    ...options,
  });

function registryWith(...plugins: FrontendGeneratorPlugin[]) {
  const registry = new FrontendPluginRegistry();
  for (const plugin of plugins) registry.register(plugin);
  return registry;
}

describe("frontend plugin contracts", () => {
  const apiContract = {
    endpoints: [
      {
        backend: "api",
        path: "/orders/{orderId}",
        method: "GET" as const,
        operationId: "getOrder",
        entity: "Order",
        authRequired: false,
        roles: [],
        permissions: [],
        queryParams: [{ name: "includeLines", type: "boolean" as const, required: false }],
        pathParams: [{ name: "orderId", type: "uuid" as const, required: true }],
        joins: [],
      },
      {
        backend: "api",
        path: "/orders",
        method: "GET" as const,
        operationId: "listOrders",
        entity: "Order",
        authRequired: false,
        roles: [],
        permissions: [],
        queryParams: [
          { name: "status", field: { entity: "Order", field: "status" }, required: false },
        ],
        pathParams: [],
        joins: [{ entity: "User", type: "left" as const, fields: ["name"] }],
        pagination: {
          strategy: "offset" as const,
          pageParam: "page",
          pageSizeParam: "pageSize",
          defaultPageSize: 20,
          maxPageSize: 100,
        },
      },
      {
        backend: "api",
        path: "/users/{id}",
        method: "PATCH" as const,
        operationId: "updateUser",
        entity: "User",
        authRequired: false,
        roles: [],
        permissions: [],
        queryParams: [],
        pathParams: [{ name: "id", type: "uuid" as const, required: true }],
        requestBody: { useCase: { entity: "User", operation: "update" as const } },
        joins: [],
      },
    ],
    entities: {
      Order: {
        fields: {
          id: { type: "uuid" as const, required: true, unique: true },
          status: { type: "enum" as const, enumName: "OrderStatus", required: true, unique: false },
        },
        relations: { user: { target: "User", type: "many-to-one" } },
      },
      User: {
        fields: {
          id: { type: "uuid" as const, required: true, unique: true },
          name: { type: "string" as const, required: true, unique: false },
        },
        relations: {},
      },
    },
    enums: { OrderStatus: ["pending", "paid"] },
  };
  const [orderEndpoint, , updateEndpoint] = apiContract.endpoints;
  if (!orderEndpoint || !updateEndpoint) throw new Error("API test fixtures are incomplete.");

  it("limits normalized API contracts to the frontend's connected backends", () => {
    const config = NordixConfigSchema.parse({
      name: "commerce",
      version: "1.0.0",
      repositories: [{ name: "app", path: "." }],
      backends: [
        {
          name: "api",
          framework: "hono",
          repository: "app",
          path: "apps/api",
          authentication: { plugin: "better-auth" },
          authorization: {
            roles: ["admin"],
            defaultRole: "admin",
            rolePermissions: { admin: ["orders:read"] },
          },
        },
        { name: "admin", framework: "hono", repository: "app", path: "apps/admin" },
      ],
      entities: {
        Order: {
          backend: "api",
          softDelete: "timestamp",
          fields: { status: { type: "string" } },
          relations: {
            user: { type: "many-to-one", target: "User", foreignKey: "userId" },
            owner: { type: "one-to-one", target: "User" },
          },
        },
        User: {
          backend: "api",
          fields: { name: { type: "string" } },
          relations: { orders: { type: "one-to-many", target: "Order" } },
        },
        AuditLog: { backend: "admin" },
      },
      endpoints: [
        {
          backend: "api",
          path: "/orders/{status}",
          method: "GET",
          entity: "Order",
          pathParams: [{ name: "status", field: { entity: "Order", field: "status" } }],
          queryParams: [{ name: "status", field: { entity: "Order", field: "status" } }],
          joins: [{ entity: "User", type: "left", fields: ["name"] }],
        },
        {
          backend: "api",
          path: "/orders",
          method: "POST",
          entity: "Order",
          requestBody: {
            name: { field: { entity: "User", field: "name" } },
            label: { type: "string", required: true },
          },
        },
        {
          backend: "api",
          path: "/users",
          method: "POST",
          entity: "User",
          requestBody: { useCase: { entity: "User", operation: "create" } },
        },
        { backend: "admin", path: "/audit-logs", method: "GET", entity: "AuditLog" },
      ],
    });
    const contract = buildFrontendApiContract(config, frontend({ connectsTo: ["api"] }));
    expect(contract.endpoints.map((endpoint) => endpoint.path)).toEqual([
      "/orders/{status}",
      "/orders",
      "/users",
    ]);
    expect(contract.entities).not.toHaveProperty("AuditLog");
    expect(contract.entities.Order?.fields).toHaveProperty("userId");
    expect(contract.entities.Order?.softDelete).toBe("timestamp");
    expect(contract.entities).toHaveProperty("User");
    expect(contract.authentication).toMatchObject({
      plugin: "better-auth",
      backend: "api",
      roles: ["admin"],
      rolePermissions: { admin: ["orders:read"] },
    });
    expect(
      buildFrontendApiContract(config, frontend({ connectsTo: ["admin"] })).authentication,
    ).toBe(undefined);
  });

  it("assigns collision-safe operation names and covers generated body variants", () => {
    const endpoints = [
      { ...orderEndpoint, operationId: "list-orders", backend: "api" },
      { ...orderEndpoint, operationId: "list_orders", backend: "api" },
      { ...orderEndpoint, operationId: "list orders", backend: "api" },
    ];
    const names = [...getFrontendOperationNames(endpoints).values()];
    expect(new Set(names).size).toBe(3);
    const unusualNames = getFrontendOperationNames([
      { ...orderEndpoint, operationId: "---" },
      { ...orderEndpoint, operationId: "123" },
    ]);
    expect([...unusualNames.values()]).toEqual(["request", "request123"]);
    expect([
      ...getFrontendOperationNames([{ ...orderEndpoint, operationId: "single" }]).values(),
    ]).toEqual(["single"]);

    const result = composeFrontendPlugins(
      "Commerce",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
      ),
      {
        endpoints: [
          { ...updateEndpoint, requestBody: { useCase: { entity: "User", operation: "create" } } },
          {
            ...updateEndpoint,
            operationId: "patchUser",
            requestBody: {
              userName: { field: { entity: "User", field: "name" } },
              optionalName: {
                field: { entity: "User", field: "name" },
                required: false,
              },
              missingName: { field: { entity: "UnknownEntity", field: "name" } },
              label: { type: "string" as const, required: true },
              optionalLabel: { type: "string" as const, required: false },
            },
          },
        ],
        entities: apiContract.entities,
        enums: apiContract.enums,
      },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const types = result.virtualFileSystem.readFile("apps/store-web/src/lib/api/types.ts");
      expect(types).toContain('"userName": string;');
      expect(types).toContain('"label": string;');
    }
  });

  it("reports a missing API client plugin for connected endpoints", () => {
    const apiWithoutPlugin = composeFrontendPlugins(
      "Commerce",
      frontend(),
      registryWith(nextjsFrontendPlugin, tailwindStylingPlugin, nativeReactUiPlugin),
      apiContract,
    );
    expect(apiWithoutPlugin.success).toBe(false);
    if (!apiWithoutPlugin.success)
      expect(apiWithoutPlugin.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_API_PLUGIN_NOT_REGISTERED",
      );
  });

  it("validates identifiers, capabilities, requirements, and dependency declarations", () => {
    const valid = {
      id: "test-plugin",
      version: "1.2.3-beta.1",
      role: "styling",
      provides: ["styling:test"],
      requires: [{ capability: "framework:react" }],
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^6.0.0" },
    };
    expect(validateFrontendPluginDescriptor(valid)).toBe(true);
    expect(validateFrontendPluginDescriptor({ ...valid, dependencies: { react: " " } })).toBe(
      false,
    );
    expect(validateFrontendPluginDescriptor({ ...valid, devDependencies: [] })).toBe(false);
    expect(validateFrontendPluginDescriptor({ ...valid, requires: [{ capability: "BAD" }] })).toBe(
      false,
    );
    expect(
      validateFrontendPluginDescriptor({ ...valid, provides: ["styling:test", "styling:test"] }),
    ).toBe(false);
    expect(validateFrontendPluginDescriptor(null)).toBe(false);
    expect(validateFrontendPluginDescriptor({ ...valid, id: "Bad_ID" })).toBe(false);
    expect(validateFrontendPluginDescriptor({ ...valid, version: "v1" })).toBe(false);
    expect(validateFrontendPluginDescriptor({ ...valid, role: "database" })).toBe(false);
  });

  it("registers immutable plugin descriptors and rejects malformed or duplicate plugins", () => {
    const registry = registryWith(nextjsFrontendPlugin);
    expect(registry.get("nextjs")).toBeDefined();
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list().map((plugin) => plugin.id)).toEqual(["nextjs"]);
    expect(Object.isFrozen(registry.get("nextjs")?.descriptor.provides)).toBe(true);
    expect(() => registry.register(nextjsFrontendPlugin)).toThrow(FrontendPluginRegistrationError);
    expect(() => registry.register(null as unknown as FrontendGeneratorPlugin)).toThrow(
      "must be an object",
    );
    expect(() =>
      registry.register({
        descriptor: { ...nextjsFrontendPlugin.descriptor, version: "bad" },
        contribute: () => [],
      }),
    ).toThrow("valid identifier");
    expect(() =>
      registry.register({
        descriptor: tailwindStylingPlugin.descriptor,
      } as FrontendGeneratorPlugin),
    ).toThrow("implement contribute");
    expect(() =>
      registry.register({
        descriptor: nextjsFrontendPlugin.descriptor,
        contribute: () => [],
      }),
    ).toThrow("createFrameworkContext");
  });

  it("composes Next.js, Tailwind, and accessible UI contributions", () => {
    const result = composeFrontendPlugins(
      "Commerce",
      frontend(),
      registryWith(nextjsFrontendPlugin, tailwindStylingPlugin, nativeReactUiPlugin),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.frameworkContext.scaffold.argumentsBeforeTarget).toContain(
      "create-next-app@15.5.26",
    );
    expect(result.frameworkContext.scaffold.argumentsAfterTarget).toContain("--tailwind");
    expect(result.developmentDependencies).toMatchObject({
      tailwindcss: "^4.0.0",
      "@tailwindcss/postcss": "^4.0.0",
    });
    expect(result.virtualFileSystem.listFiles()).toContain(
      "apps/store-web/src/components/ui/dialog.tsx",
    );
    expect(result.virtualFileSystem.readFile("apps/store-web/src/app/globals.css")).toContain(
      '@import "tailwindcss"',
    );
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/ui/dialog.tsx"),
    ).toContain("dialog.showModal()");
    const page = result.virtualFileSystem.readFile("apps/store-web/src/app/page.tsx");
    expect(page).toContain("A thoughtful starting point for Commerce.");
    expect(page).toContain('aria-label="Generated project details"');
  });

  it("generates typed endpoint clients with path, query, entity, and enum contracts", () => {
    const result = composeFrontendPlugins(
      "Commerce",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
      ),
      apiContract,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const endpoints = result.virtualFileSystem.readFile("apps/store-web/src/lib/api/endpoints.ts");
    const types = result.virtualFileSystem.readFile("apps/store-web/src/lib/api/types.ts");
    expect(endpoints).toContain("export async function getOrder(input: getOrderInput)");
    expect(endpoints).toContain("encodeURIComponent(String(input.path?.orderId))");
    expect(endpoints).toContain("url.searchParams.set(key, String(value))");
    expect(types).toContain('"status": "pending" | "paid";');
    expect(types).toContain("export interface getOrderInput");
    expect(types).toContain('"User": Pick<UserResponse, "name"> | null;');
    expect(types).toContain("readonly items:");
    const explorer = result.virtualFileSystem.readFile(
      "apps/store-web/src/components/api/api-explorer.tsx",
    );
    expect(explorer).toContain('"getOrder"');
    expect(explorer).toContain('"PATCH"');
    expect(explorer).toContain("pathParams");
    expect(explorer).toContain("bodyExample");
    expect(explorer).toContain("Required permissions");
    expect(explorer).toContain("credentials");
    expect(explorer).toContain('"enumValues": [');
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/app/api-explorer/page.tsx"),
    ).toContain("ApiExplorer");
    expect(result.virtualFileSystem.readFile("apps/store-web/src/app/page.tsx")).toContain(
      'href="/api-explorer"',
    );

    const apiFramework = nextjsFrontendPlugin.createFrameworkContext?.(frontend());
    if (!apiFramework) throw new Error("Next.js API fixture is unavailable.");
    const bodyExamples = typedFetchApiPlugin.contribute({
      projectName: "Commerce",
      frontend: frontend(),
      framework: apiFramework,
      availableCapabilities: new Set<string>(),
      api: {
        endpoints: [
          {
            ...orderEndpoint,
            requestBody: { useCase: { entity: "Order", operation: "create" } },
          },
        ],
        entities: {
          Order: {
            fields: {
              count: { type: "number" as const, required: true },
              active: { type: "boolean" as const, required: true },
              details: { type: "json" as const, required: true },
              status: { type: "enum" as const, enumName: "Status", required: true },
              missingStatus: { type: "enum" as const, enumName: "Missing", required: false },
              unspecifiedStatus: { type: "enum" as const, required: false } as never,
              title: { type: "string" as const, required: false, default: "Draft" },
            },
            relations: {},
          },
        },
        enums: { Status: ["pending"] },
      },
    } as never);
    const bodyExplorer = bodyExamples.find(({ path }) =>
      path.endsWith("api-explorer.tsx"),
    )?.content;
    expect(bodyExplorer).toContain('"count": 0');
    expect(bodyExplorer).toContain('"active": false');
    expect(bodyExplorer).toContain('"details": {}');
    expect(bodyExplorer).toContain('"status": "pending"');
    expect(bodyExplorer).toContain('"missingStatus": ""');
    expect(bodyExplorer).toContain('"title": "Draft"');
  });

  it("covers optional API parameter types, projections, and empty generated bodies", () => {
    const extended = {
      ...apiContract,
      entities: {
        ...apiContract.entities,
        Order: {
          ...apiContract.entities.Order,
          fields: {
            ...apiContract.entities.Order.fields,
            optionalText: { type: "string" as const, required: false },
            amount: { type: "number" as const, required: true },
            active: { type: "boolean" as const, required: true },
            created: { type: "date" as const, required: true },
            metadata: { type: "json" as const, required: true },
            unknownStatus: { type: "enum" as const, enumName: "MissingEnum", required: true },
          },
          relations: {
            ...apiContract.entities.Order.relations,
            lines: { target: "User", type: "one-to-many" },
          },
        },
        Empty: { fields: {}, relations: {} },
      },
      endpoints: [
        ...apiContract.endpoints,
        {
          ...updateEndpoint,
          operationId: "patchByStringKey",
          method: "PATCH" as const,
          path: "/users/{key}",
          pathParams: [{ name: "key", type: "string" as const, required: true }],
          requestBody: undefined,
        },
        {
          ...updateEndpoint,
          operationId: "patchOrderById",
          method: "PATCH" as const,
          entity: "Order",
          path: "/orders/{orderId}",
          pathParams: [
            { name: "orderId", field: { entity: "Order", field: "id" }, required: true as const },
          ],
          requestBody: undefined,
        },
        {
          ...orderEndpoint,
          operationId: undefined,
          path: "/orders/{id}",
          pathParams: [{ name: "id", type: "uuid" as const, required: true }],
          queryParams: [
            { name: "amount", type: "number" as const, required: true },
            { name: "active", type: "boolean" as const, required: false },
            { name: "created", type: "date" as const, required: false },
            { name: "reference", type: "uuid" as const, required: false },
            { name: "search", type: "string" as const, required: false },
            { name: "unknown", type: "enum" as const, enumName: "MissingEnum", required: false },
            {
              name: "statuses",
              field: { entity: "Order", field: "status" },
              operator: "in" as const,
              required: false,
            },
            { name: "amounts", type: "number" as const, operator: "in" as const, required: false },
          ],
          joins: [{ entity: "User", type: "inner" as const, fields: [] }],
        },
        {
          ...orderEndpoint,
          operationId: "createEmpty",
          entity: "Empty",
          method: "POST" as const,
          path: "/empty",
          pathParams: [],
          queryParams: [],
          joins: [{ entity: "User", type: "inner" as const, fields: ["name"] }],
          requestBody: { useCase: { entity: "UnknownEntity", operation: "create" as const } },
        },
        {
          ...updateEndpoint,
          operationId: "deleteOrder",
          entity: "Order",
          method: "DELETE" as const,
          path: "/orders/{orderId}",
          pathParams: [
            { name: "orderId", field: { entity: "Order", field: "id" }, required: true as const },
          ],
          queryParams: [],
          requestBody: undefined,
        },
        {
          ...orderEndpoint,
          operationId: "postEmptyBody",
          method: "POST" as const,
          path: "/empty-body",
          entity: "Empty",
          pathParams: [],
          queryParams: [],
          joins: [],
          requestBody: {},
        },
        {
          ...updateEndpoint,
          operationId: "deleteByKey",
          entity: "Order",
          method: "DELETE" as const,
          path: "/orders/{key}",
          pathParams: [{ name: "key", type: "uuid" as const, required: true }],
          queryParams: [],
          requestBody: undefined,
        },
        {
          ...orderEndpoint,
          operationId: "createUnknownEntity",
          entity: "UnknownEntity",
          method: "POST" as const,
          path: "/unknown",
          pathParams: [],
          queryParams: [],
          joins: [{ entity: "User", type: "inner" as const, fields: ["name"] }],
          requestBody: { useCase: { entity: "UnknownEntity", operation: "create" as const } },
        },
        {
          ...orderEndpoint,
          operationId: "customBodyOptionalFields",
          method: "POST" as const,
          path: "/custom-body",
          pathParams: [],
          queryParams: [],
          joins: [],
          requestBody: {
            optionalField: { type: "string" as const, required: false },
            missingField: {
              field: { entity: "UnknownEntity", field: "missing" },
              required: false,
            },
          },
        },
        {
          ...updateEndpoint,
          operationId: "patchByStringKey",
          method: "PATCH" as const,
          path: "/users/{key}",
          pathParams: [{ name: "key", type: "string" as const, required: true }],
          requestBody: undefined,
        },
      ],
    };
    const result = composeFrontendPlugins(
      "Commerce",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
      ),
      extended,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const types = result.virtualFileSystem.readFile("apps/store-web/src/lib/api/types.ts");
    const endpoints = result.virtualFileSystem.readFile("apps/store-web/src/lib/api/endpoints.ts");
    expect(types).toContain('readonly ("pending" | "paid")[]');
    expect(types).toContain('"unknownStatus": string;');
    expect(types).toContain("Pick<UserResponse, never>[]");
    expect(types).toContain("Record<string, never>");
    expect(types).toContain('"amounts"?: readonly (number)[];');
    expect(endpoints).toContain("export async function getOrdersId");
    expect(types).toContain('"amount": number;');
    expect(endpoints).toContain("export async function deleteByKey");
  });

  it("generates selected server-state integrations and their runtime dependencies", () => {
    const stateApi = {
      ...apiContract,
      endpoints: [
        ...apiContract.endpoints,
        {
          ...updateEndpoint,
          operationId: "patchByStringKey",
          method: "PATCH" as const,
          path: "/users/{key}",
          pathParams: [{ name: "key", type: "string" as const, required: true }],
          requestBody: undefined,
        },
        {
          ...updateEndpoint,
          operationId: "patchOrderById",
          entity: "Order",
          method: "PATCH" as const,
          path: "/orders/{orderId}",
          pathParams: [
            { name: "orderId", field: { entity: "Order", field: "id" }, required: true as const },
          ],
          requestBody: undefined,
        },
        {
          ...updateEndpoint,
          operationId: "deleteByKey",
          entity: "Order",
          method: "DELETE" as const,
          path: "/orders/{key}",
          pathParams: [{ name: "key", type: "uuid" as const, required: true }],
          requestBody: undefined,
        },
      ],
    };
    const query = composeFrontendPlugins(
      "Commerce",
      frontend({
        stateManagement: { server: "tanstack-query", generateHooks: true, optimisticUpdates: true },
      }),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
        tanstackQueryServerStatePlugin,
        zustandClientStatePlugin,
      ),
      stateApi,
    );
    expect(query.success).toBe(true);
    if (!query.success) return;
    expect(query.runtimeDependencies).toMatchObject({ "@tanstack/react-query": "^5.80.7" });
    expect(query.virtualFileSystem.readFile("apps/store-web/src/lib/api/hooks.ts")).toContain(
      "useGetOrder",
    );
    expect(query.virtualFileSystem.readFile("apps/store-web/src/lib/api/hooks.ts")).toContain(
      '["Order","User"]',
    );
    expect(query.virtualFileSystem.readFile("apps/store-web/src/lib/api/hooks.ts")).toContain(
      "onMutate",
    );
    expect(query.virtualFileSystem.readFile("apps/store-web/src/app/providers.tsx")).toContain(
      "QueryClientProvider",
    );

    const swr = composeFrontendPlugins(
      "Commerce",
      frontend({ stateManagement: { server: "swr", generateHooks: true } }),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
        swrServerStatePlugin,
        zustandClientStatePlugin,
      ),
      apiContract,
    );
    expect(swr.success).toBe(true);
    if (!swr.success) return;
    expect(swr.runtimeDependencies).toMatchObject({ swr: "^2.3.3" });
    expect(swr.virtualFileSystem.readFile("apps/store-web/src/lib/api/hooks.ts")).toContain(
      "useSWR",
    );
    expect(swr.virtualFileSystem.listFiles()).toContain("apps/store-web/src/app/providers.tsx");

    const frameworkContext = nextjsFrontendPlugin.createFrameworkContext?.(frontend());
    const inactiveContext = {
      projectName: "Commerce",
      frontend: frontend({ stateManagement: { server: "tanstack-query", generateHooks: false } }),
      framework: frameworkContext,
      availableCapabilities: new Set<string>(),
      api: apiContract,
    } as never;
    expect(tanstackQueryServerStatePlugin.contribute(inactiveContext)).toEqual([]);
    expect(swrServerStatePlugin.contribute(inactiveContext)).toEqual([]);

    const noOptimism = composeFrontendPlugins(
      "Commerce",
      frontend({ stateManagement: { server: "tanstack-query", generateHooks: true } }),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
        tanstackQueryServerStatePlugin,
        zustandClientStatePlugin,
      ),
      apiContract,
    );
    expect(noOptimism.success).toBe(true);
    if (noOptimism.success)
      expect(
        noOptimism.virtualFileSystem.readFile("apps/store-web/src/lib/api/hooks.ts"),
      ).not.toContain("onMutate");
  });

  it("generates an empty API client and uses the framework API URL convention", () => {
    const frameworkContext = nextjsFrontendPlugin.createFrameworkContext?.(frontend());
    const files = typedFetchApiPlugin.contribute({
      projectName: "Commerce",
      frontend: frontend(),
      framework: frameworkContext
        ? {
            ...frameworkContext,
            conventions: { publicApiBaseUrlExpression: 'process.env.NEXT_PUBLIC_API_URL ?? ""' },
          }
        : ({} as never),
      availableCapabilities: new Set<string>(),
      api: { endpoints: [], entities: {}, enums: {} },
    } as never);
    expect(files.find(({ path }) => path.endsWith("/client.ts"))?.content).toContain(
      "process.env.NEXT_PUBLIC_API_URL",
    );
    expect(files.find(({ path }) => path.endsWith("/endpoints.ts"))?.content).not.toContain(
      "import type {",
    );

    const fallbackFiles = typedFetchApiPlugin.contribute({
      projectName: "Commerce",
      frontend: frontend(),
      framework: frameworkContext ? { ...frameworkContext, conventions: {} } : ({} as never),
      availableCapabilities: new Set<string>(),
      api: { endpoints: [], entities: {}, enums: {} },
    } as never);
    expect(fallbackFiles.find(({ path }) => path.endsWith("/client.ts"))?.content).toContain(
      "__NORDIX_API_BASE_URL__",
    );
  });

  it("generates auth UI and secure client-state modules from the backend contract", () => {
    const authentication = {
      plugin: "better-auth",
      backend: "api",
      methods: ["email-password", "username-password"],
      identityProviders: ["google", "github"],
      features: ["two-factor", "password-recovery", "email-verification"],
      roles: ["admin", "customer"],
      defaultRole: "customer",
      rolePermissions: { admin: ["*"], customer: ["orders:read"] },
    };
    const result = composeFrontendPlugins(
      "Commerce",
      frontend({
        authUI: true,
        stateManagement: { client: "zustand", server: "native-fetch", generateHooks: false },
      }),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        zustandClientStatePlugin,
        betterAuthFrontendPlugin,
      ),
      { endpoints: [], entities: {}, enums: {}, authentication },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.runtimeDependencies).toMatchObject({
      zustand: "^5.0.8",
      "better-auth": "^1.7.7",
    });
    const generated = result.virtualFileSystem.listFiles();
    expect(generated).toContain("apps/store-web/src/app/sign-in/page.tsx");
    expect(generated).toContain("apps/store-web/src/app/sign-up/page.tsx");
    expect(generated).toContain("apps/store-web/src/components/auth/auth-controls.tsx");
    expect(generated).toContain("apps/store-web/src/components/auth/sign-up-form.tsx");
    expect(generated).toContain("apps/store-web/src/components/auth/session-view-sync.tsx");
    expect(result.virtualFileSystem.readFile("apps/store-web/src/app/page.tsx")).toContain(
      "<AuthControls />",
    );
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/auth-controls.tsx"),
    ).toContain("<SignOutButton />");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-up-form.tsx"),
    ).toContain("authClient.signUp.email");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-up-form.tsx"),
    ).toContain("minLength={4}");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-up-form.tsx"),
    ).toContain("Could not reach the authentication server.");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-in-form.tsx"),
    ).toContain("Could not reach the authentication server.");
    const authClient = result.virtualFileSystem.readFile("apps/store-web/src/lib/auth/client.ts");
    expect(authClient).toContain("usernameClient()");
    expect(authClient).toContain("twoFactorClient()");
    expect(authClient).toContain('credentials: "include"');
    const permissions = result.virtualFileSystem.readFile(
      "apps/store-web/src/lib/auth/permissions.ts",
    );
    expect(permissions).toContain('"orders:read"');
    expect(permissions).toContain("Protected operations remain enforced by the generated backend.");
    expect(result.virtualFileSystem.readFile("apps/store-web/src/app/providers.tsx")).toContain(
      "SessionViewSync",
    );

    const contextState = composeFrontendPlugins(
      "Commerce",
      frontend({
        stateManagement: { client: "context", server: "native-fetch", generateHooks: false },
      }),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        contextClientStatePlugin,
      ),
      { endpoints: [], entities: {}, enums: {} },
    );
    expect(contextState.success).toBe(true);
    if (contextState.success) {
      expect(contextState.virtualFileSystem.listFiles()).toContain(
        "apps/store-web/src/stores/client-state-provider.tsx",
      );
      expect(
        contextState.virtualFileSystem.readFile("apps/store-web/src/app/providers.tsx"),
      ).toContain("ClientStateProvider");
    }

    const authOnly = composeFrontendPlugins(
      "Commerce",
      frontend({
        authUI: true,
        stateManagement: { client: "none", server: "native-fetch", generateHooks: false },
      }),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        betterAuthFrontendPlugin,
      ),
      {
        endpoints: [],
        entities: {},
        enums: {},
        authentication: {
          ...authentication,
          methods: ["email-password"],
          identityProviders: [],
          features: [],
        },
      },
    );
    expect(authOnly.success).toBe(true);
    if (authOnly.success) {
      const signIn = authOnly.virtualFileSystem.readFile(
        "apps/store-web/src/components/auth/sign-in-form.tsx",
      );
      expect(signIn).toContain('import { useState, type FormEvent } from "react";');
      expect(signIn).not.toContain("setMode");
      expect(signIn).not.toContain("Continue with google");
      expect(authOnly.virtualFileSystem.readFile("apps/store-web/src/app/providers.tsx")).toContain(
        "return children;",
      );
    }
  });

  it("supports legacy client-state names and covers authentication plugin boundaries", () => {
    const legacyState = composeFrontendPlugins(
      "Commerce",
      frontend({ stateManagement: "context" }),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        contextClientStatePlugin,
      ),
      { endpoints: [], entities: {}, enums: {} },
    );
    expect(legacyState.success).toBe(true);

    expect(frontendRootShellOwnerRole(new Set())).toBeUndefined();

    const definition = frontend();
    const framework = nextjsFrontendPlugin.createFrameworkContext?.(definition);
    expect(framework).toBeDefined();
    if (!framework) return;
    const baseContext = {
      projectName: "Commerce",
      frontend: definition,
      framework: { ...framework, conventions: {} },
      availableCapabilities: new Set(["framework:react", "authentication:session"]),
    };
    expect(() =>
      betterAuthFrontendPlugin.contribute({
        ...baseContext,
        api: { endpoints: [], entities: {}, enums: {} },
      }),
    ).toThrow("requires a connected backend authentication plugin");

    const files = betterAuthFrontendPlugin.contribute({
      ...baseContext,
      api: {
        endpoints: [],
        entities: {},
        enums: {},
        authentication: {
          plugin: "better-auth",
          backend: "api",
          methods: ["email-password"],
          identityProviders: [],
          features: [],
          roles: [],
          rolePermissions: {},
        },
      },
    });
    expect(files.find(({ path }) => path.endsWith("/lib/auth/client.ts"))?.content).toContain(
      "__NORDIX_API_BASE_URL__",
    );
  });

  it("rejects frontend auth UI when no connected authentication is available", () => {
    const result = composeFrontendPlugins(
      "Commerce",
      frontend({ authUI: true }),
      registryWith(nextjsFrontendPlugin, tailwindStylingPlugin, nativeReactUiPlugin),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_AUTH_UI_REQUIRES_AUTHENTICATION",
      );
  });

  it("supports plain CSS and safely escapes generated project text", () => {
    const result = composeFrontendPlugins(
      "<Shop & Co>",
      frontend({ framework: "next.js", styling: "css" }),
      registryWith(nextjsFrontendPlugin, plainCssStylingPlugin, nativeReactUiPlugin),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.frameworkContext.scaffold.argumentsAfterTarget).toContain("--no-tailwind");
    expect(result.virtualFileSystem.readFile("apps/store-web/src/app/globals.css")).not.toContain(
      '@import "tailwindcss"',
    );
    expect(result.virtualFileSystem.readFile("apps/store-web/src/app/page.tsx")).toContain(
      "&lt;Shop &amp; Co&gt;",
    );
    expect(result.developmentDependencies).toEqual({});
  });

  it("reports missing plugins, incompatible roles, and missing capabilities", () => {
    const missing = composeFrontendPlugins("Shop", frontend(), new FrontendPluginRegistry());
    expect(missing.success).toBe(false);
    if (!missing.success)
      expect(missing.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_NOT_REGISTERED",
      );

    const wrongRole = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(nextjsFrontendPlugin, nativeReactUiPlugin, {
        ...plainCssStylingPlugin,
        descriptor: { ...plainCssStylingPlugin.descriptor, id: "tailwind", role: "ui" },
      }),
    );
    expect(wrongRole.success).toBe(false);
    if (!wrongRole.success)
      expect(wrongRole.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_ROLE_MISMATCH",
      );

    const capabilityPlugin: FrontendGeneratorPlugin = {
      ...plainCssStylingPlugin,
      descriptor: {
        ...plainCssStylingPlugin.descriptor,
        id: "css",
        requires: [{ capability: "framework:missing" }],
      },
    };
    const missingCapability = composeFrontendPlugins(
      "Shop",
      frontend({ styling: "css" }),
      registryWith(nextjsFrontendPlugin, capabilityPlugin, nativeReactUiPlugin),
    );
    expect(missingCapability.success).toBe(false);
    if (!missingCapability.success)
      expect(missingCapability.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_CAPABILITY_MISSING",
      );
  });

  it("reports invalid framework contexts, plugin failures, unsafe paths, and collisions", () => {
    const invalidContext = {
      ...nextjsFrontendPlugin,
      createFrameworkContext: () => ({ pluginId: "other" }) as never,
    };
    const invalid = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(invalidContext, tailwindStylingPlugin, nativeReactUiPlugin),
    );
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_FRAMEWORK_CONTEXT_INVALID",
      );

    const contextVariants: readonly ((context: unknown) => unknown)[] = [
      () => null,
      (context) => ({ ...(context as object), pluginId: "other" }),
      (context) => ({ ...(context as object), applicationRoot: "other" }),
      (context) => ({ ...(context as object), runtime: "" }),
      (context) => ({ ...(context as object), codeRoot: "../outside" }),
      (context) => ({ ...(context as object), scaffold: undefined }),
      (context) => ({
        ...(context as object),
        scaffold: { executable: "pnpm", argumentsBeforeTarget: "bad", argumentsAfterTarget: [] },
      }),
    ];
    for (const mutate of contextVariants) {
      const plugin: FrontendGeneratorPlugin = {
        ...nextjsFrontendPlugin,
        createFrameworkContext: (definition) =>
          mutate(nextjsFrontendPlugin.createFrameworkContext?.(definition)),
      };
      const result = composeFrontendPlugins(
        "Shop",
        frontend(),
        registryWith(plugin, tailwindStylingPlugin, nativeReactUiPlugin),
      );
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.diagnostics.map(({ code }) => code)).toContain(
          "FRONTEND_FRAMEWORK_CONTEXT_INVALID",
        );
    }

    const noContextRegistry = registryWith(
      nextjsFrontendPlugin,
      tailwindStylingPlugin,
      nativeReactUiPlugin,
    );
    Object.defineProperty(noContextRegistry.get("nextjs"), "createFrameworkContext", {
      value: undefined,
    });
    const noContext = composeFrontendPlugins("Shop", frontend(), noContextRegistry);
    expect(noContext.success).toBe(false);
    if (!noContext.success)
      expect(noContext.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_FRAMEWORK_CONTEXT_MISSING",
      );

    const failingPlugin: FrontendGeneratorPlugin = {
      ...nativeReactUiPlugin,
      descriptor: { ...nativeReactUiPlugin.descriptor, id: "native" },
      contribute: () => {
        throw new Error("contribution failed");
      },
    };
    const failure = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(nextjsFrontendPlugin, tailwindStylingPlugin, failingPlugin),
    );
    expect(failure.success).toBe(false);
    if (!failure.success)
      expect(failure.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_CONTRIBUTION_FAILED",
      );

    for (const contribute of [
      () => null,
      () => {
        throw "plugin failure";
      },
    ]) {
      const plugin: FrontendGeneratorPlugin = {
        ...nativeReactUiPlugin,
        contribute: contribute as FrontendGeneratorPlugin["contribute"],
      };
      const result = composeFrontendPlugins(
        "Shop",
        frontend(),
        registryWith(nextjsFrontendPlugin, tailwindStylingPlugin, plugin),
      );
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.diagnostics.map(({ code }) => code)).toContain(
          "FRONTEND_PLUGIN_CONTRIBUTION_FAILED",
        );
    }

    const outputPlugin = (id: string, path: string): FrontendGeneratorPlugin => ({
      descriptor: { id, version: "1.0.0", role: "ui", provides: ["ui:test"] },
      contribute: () => [{ path, content: id }],
    });
    const collision = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        outputPlugin("native", "apps/store-web/src/app/globals.css"),
      ),
    );
    expect(collision.success).toBe(false);
    if (!collision.success)
      expect(collision.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_PATH_COLLISION",
      );

    const unsafeOutput = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        outputPlugin("native", "../escape.tsx"),
      ),
    );
    expect(unsafeOutput.success).toBe(false);
    if (!unsafeOutput.success)
      expect(unsafeOutput.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_PATH_INVALID",
      );

    const crossApplicationOutput = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        outputPlugin("native", "apps/another-app/src/page.tsx"),
      ),
    );
    expect(crossApplicationOutput.success).toBe(false);
    if (!crossApplicationOutput.success)
      expect(crossApplicationOutput.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_PATH_OUTSIDE_APPLICATION",
      );

    const invalidOutputPlugin: FrontendGeneratorPlugin = {
      descriptor: { id: "native", version: "1.0.0", role: "ui", provides: ["ui:test"] },
      contribute: () => [null as never],
    };
    const invalidOutput = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(nextjsFrontendPlugin, tailwindStylingPlugin, invalidOutputPlugin),
    );
    expect(invalidOutput.success).toBe(false);
    if (!invalidOutput.success)
      expect(invalidOutput.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_PLUGIN_OUTPUT_INVALID",
      );
  });

  it("handles dependency conflicts, optional selections, and empty contributions", () => {
    const conflictedFramework: FrontendGeneratorPlugin = {
      ...nextjsFrontendPlugin,
      descriptor: { ...nextjsFrontendPlugin.descriptor, dependencies: { react: "^18.0.0" } },
    };
    const conflictedStyling: FrontendGeneratorPlugin = {
      ...plainCssStylingPlugin,
      descriptor: {
        ...plainCssStylingPlugin.descriptor,
        dependencies: { react: "^19.0.0" },
      },
    };
    const conflict = composeFrontendPlugins(
      "Shop",
      frontend({ styling: "css" }),
      registryWith(conflictedFramework, conflictedStyling, nativeReactUiPlugin),
    );
    expect(conflict.success).toBe(false);
    if (!conflict.success)
      expect(conflict.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_DEPENDENCY_VERSION_CONFLICT",
      );

    const frontendWithoutSelections = {
      ...frontend(),
      styling: undefined,
      ui: undefined,
    } as unknown as ReturnType<typeof frontend>;
    const minimalUi = { ...nativeReactUiPlugin, contribute: () => [] };
    const minimal = composeFrontendPlugins(
      "Shop",
      frontendWithoutSelections,
      registryWith(
        nextjsFrontendPlugin,
        { ...tailwindStylingPlugin, contribute: () => [] },
        minimalUi,
      ),
    );
    expect(minimal.success).toBe(true);
    if (minimal.success) expect(minimal.virtualFileSystem.listFiles()).toEqual([]);
    const rootApplication = composeFrontendPlugins(
      "Shop",
      frontend({ path: "." }),
      registryWith(
        nextjsFrontendPlugin,
        { ...tailwindStylingPlugin, contribute: () => [] },
        {
          ...nativeReactUiPlugin,
          contribute: () => [{ path: "src/page.tsx", content: "root app" }],
        },
      ),
    );
    expect(rootApplication.success).toBe(true);

    const pluginWithoutRequirementDescription: FrontendGeneratorPlugin = {
      ...plainCssStylingPlugin,
      descriptor: {
        ...plainCssStylingPlugin.descriptor,
        id: "css",
        requires: [{ capability: "framework:unknown" }],
      },
    };
    const missingDescription = composeFrontendPlugins(
      "Shop",
      frontend({ styling: "css" }),
      registryWith(nextjsFrontendPlugin, pluginWithoutRequirementDescription, nativeReactUiPlugin),
    );
    expect(missingDescription.success).toBe(false);
    if (!missingDescription.success)
      expect(missingDescription.diagnostics[0]?.message).toContain("requires capability");

    const unknownErrorContext: FrontendGeneratorPlugin = {
      ...nextjsFrontendPlugin,
      createFrameworkContext: () => {
        throw "context failed";
      },
    };
    const unknownError = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(unknownErrorContext, tailwindStylingPlugin, nativeReactUiPlugin),
    );
    expect(unknownError.success).toBe(false);
    if (!unknownError.success)
      expect(unknownError.diagnostics[0]?.message).toBe("Frontend framework context is invalid.");
  });

  it("covers feature-screen generation, CRUD branches, and composer registration", () => {
    const [getOrder, listOrders, updateUser] = apiContract.endpoints;
    if (!getOrder || !listOrders || !updateUser) throw new Error("Incomplete API fixtures.");
    const framework = nextjsFrontendPlugin.createFrameworkContext?.(frontend());
    if (!framework) throw new Error("Next.js framework fixture is unavailable.");
    const endpoints = [
      ...apiContract.endpoints.map((endpoint) =>
        endpoint === listOrders
          ? {
              ...endpoint,
              pagination: { strategy: "offset" as const },
              queryParams: [...endpoint.queryParams, { name: "search", required: false }],
            }
          : endpoint,
      ),
      {
        ...listOrders,
        method: "GET" as const,
        operationId: "searchOrders",
        pagination: undefined,
        queryParams: [{ name: "search", required: false }],
      },
      {
        ...listOrders,
        method: "POST" as const,
        path: "/orders",
        operationId: "createOrder",
        pathParams: [],
        queryParams: [],
        roles: ["admin"],
        permissions: ["orders:create"],
        requestBody: { useCase: { entity: "Order", operation: "create" as const } },
      },
      {
        ...getOrder,
        method: "DELETE" as const,
        operationId: "deleteOrder",
        path: "/orders/{orderId}",
        queryParams: [],
      },
      {
        ...getOrder,
        method: "PUT" as const,
        operationId: "replaceOrder",
        requestBody: { useCase: { entity: "Order", operation: "update" as const } },
        permissions: ["orders:update"],
      },
      {
        ...listOrders,
        entity: "Invoice",
        method: "POST" as const,
        operationId: "createInvoice",
        path: "/invoices",
        pathParams: [],
        queryParams: [],
        roles: ["billing"],
        requestBody: {
          title: { type: "string" as const, required: true },
          status: {
            field: { entity: "Order", field: "status" },
            required: false,
          },
          unknown: {
            field: { entity: "Missing", field: "unknown" },
          },
          optionalStatus: { field: { entity: "Order", field: "status" } },
          unknownEnum: { type: "enum" as const, enumName: "MissingEnum", required: true },
          unspecifiedEnum: { type: "enum" as const, required: false } as never,
        },
      },
      {
        ...listOrders,
        entity: "MissingRecord",
        method: "POST" as const,
        operationId: "createMissingRecord",
        path: "/missing-records",
        pathParams: [],
        queryParams: [],
        requestBody: { useCase: { entity: "AbsentEntity", operation: "create" as const } },
      },
      {
        ...getOrder,
        entity: "Invoice",
        method: "DELETE" as const,
        operationId: "deleteInvoice",
        path: "/invoices/{id}",
      },
    ];
    const grouped = groupEndpointsByEntity(endpoints);
    expect(groupEndpointsByEntity([])).toEqual(new Map());
    expect(grouped.get("Order")?.customEndpoints).toHaveLength(1);

    const context = {
      projectName: "Shop",
      frontend: frontend({ stateManagement: { server: "tanstack-query", generateHooks: true } }),
      framework,
      availableCapabilities: new Set<string>(),
      api: {
        ...apiContract,
        endpoints,
        authentication: {
          plugin: "better-auth",
          backend: "api",
          methods: ["email"],
          identityProviders: [],
          features: [],
          roles: ["admin"],
          defaultRole: "admin",
          rolePermissions: {},
        },
        entities: {
          ...apiContract.entities,
          Order: {
            softDelete: "boolean" as const,
            fields: {
              id: { type: "uuid" as const, required: true },
              createdAt: { type: "date" as const, required: true },
              status: { type: "enum" as const, enumName: "OrderStatus", required: true },
              amount: { type: "number" as const, required: true },
              paid: { type: "boolean" as const, required: false },
              placedAt: { type: "date" as const, required: false },
              metadata: { type: "json" as const, required: false },
              requiredJson: { type: "json" as const, required: true },
              label: { type: "string" as const, required: false, default: "Draft" },
              optionalStatus: {
                type: "enum" as const,
                enumName: "OrderStatus",
                required: false,
              },
              note: { type: "string" as const, required: true },
            },
            relations: {},
          },
        },
      },
    } as const;
    const files = generateFeatureScreenFiles(context);
    expect(files).toHaveLength(8);
    const screen = files[0]?.content ?? "";
    expect(screen).toContain("useListOrders");
    expect(screen).toContain('"orders:create"');
    expect(screen).toContain('"admin"');
    expect(screen).toContain("hasRole(role)");
    expect(screen).toContain("hasPermission(permission)");
    expect(screen).toContain('<option value="pending">pending</option>');
    expect(screen).toContain("zodResolver");
    expect(screen).toContain('featureForm.register("amount", { valueAsNumber: true })');
    expect(screen).toContain('featureForm.register("paid")');
    expect(screen).toContain("featureForm.handleSubmit(handleSave)");
    expect(screen).toContain('"amount": z.preprocess');
    expect(screen).toContain('"note": z.string().min(1, "Required")');
    expect(screen).toContain('"metadata": z.unknown().optional()');
    expect(screen).toContain("marked inactive and hidden from active lists");
    expect(screen).toContain('"label": z.string().optional().default("Draft")');
    const invoiceScreen =
      files.find(({ path }) => path.endsWith("invoice-screen.tsx"))?.content ?? "";
    expect(invoiceScreen).toContain('"title": z.string().min(1, "Required")');
    expect(invoiceScreen).toContain('"unknown": z.unknown()');
    const timestampDeleteScreen = generateFeatureScreenFiles({
      ...context,
      api: {
        ...context.api,
        entities: {
          ...context.api.entities,
          Order: { ...context.api.entities.Order, softDelete: "timestamp" },
        },
      },
    });
    expect(timestampDeleteScreen[0]?.content).toContain(
      "archived using the backend soft-delete policy",
    );
    expect(invoiceScreen).toContain("permanently removes this record");
    expect(screen).toContain("Page {page}");
    expect(files[1]?.content).toContain("Order Records | NordixGen");
    expect(
      generateFeatureScreenFiles({ ...context, api: { ...context.api, endpoints: [] } }),
    ).toEqual([]);

    const swrFiles = generateFeatureScreenFiles({
      ...context,
      frontend: frontend({ stateManagement: { server: "swr", generateHooks: true } }),
    });
    expect(swrFiles[0]?.content).toContain("createMutation.trigger");
    const nativeFiles = generateFeatureScreenFiles({
      ...context,
      frontend: frontend({ stateManagement: { server: "native-fetch", generateHooks: false } }),
    });
    expect(nativeFiles[0]?.content).toContain("useCallback");
    expect(nativeFiles[0]?.content).toContain("await refetch()");
    expect(nativeFiles[0]?.content).toContain('import { useCallback, useEffect } from "react";');
    expect(nativeFiles[0]?.content).toContain('"page": page');

    const withoutAuth = generateFeatureScreenFiles({
      ...context,
      api: { ...context.api, authentication: undefined },
    });
    expect(withoutAuth[0]?.content).not.toContain("useSessionView");

    const optionalAndEscapedFields = generateFeatureScreenFiles({
      ...context,
      api: {
        ...context.api,
        entities: {
          ...context.api.entities,
          Order: {
            fields: {
              id: { type: "uuid" as const, required: true },
              createdAt: { type: "date" as const, required: true },
              updatedAt: { type: "date" as const, required: true },
              isDeleted: { type: "boolean" as const, required: true },
              deletedAt: { type: "date" as const, required: false },
              status: {
                type: "enum" as const,
                enumName: "OrderStatus",
                required: false,
              },
              label: { type: "string" as const, required: false, default: "<hello & goodbye>" },
            },
            relations: {},
          },
        },
      },
    });
    expect(optionalAndEscapedFields[0]?.content).toContain("label");
    expect(optionalAndEscapedFields[0]?.content).not.toContain('name="createdAt"');

    const plainStylingFrontend = frontend({ styling: "css" });
    const plainStylingFramework =
      nextjsFrontendPlugin.createFrameworkContext?.(plainStylingFrontend);
    if (!plainStylingFramework) throw new Error("Plain CSS framework fixture is unavailable.");
    const plainStylingFiles = generateFeatureScreenFiles({
      ...context,
      frontend: plainStylingFrontend,
      framework: plainStylingFramework,
      api: { ...context.api, endpoints: [listOrders], entities: {} },
    });
    expect(plainStylingFiles[0]?.content).toContain("FeatureScreen");

    const noCrud = generateFeatureScreenFiles({
      ...context,
      api: {
        ...context.api,
        endpoints: [getOrder],
        entities: {},
      },
    });
    expect(noCrud[0]?.content).not.toContain("<Dialog");
    expect(noCrud[0]?.content).not.toContain("<TableCell>Actions</TableCell>");

    const noOperations = generateFeatureScreenFiles({
      ...context,
      api: {
        ...context.api,
        endpoints: [
          {
            ...listOrders,
            method: "POST" as const,
            entity: "EmptyRecord",
            operationId: "createEmptyRecord",
          },
        ],
        entities: {},
      },
    });
    expect(noOperations[0]?.content).toContain("No delete endpoint");
    expect(noOperations[0]?.content).toContain("This entity has no update endpoint");

    const inferredPathParameters = generateFeatureScreenFiles({
      ...context,
      frontend: frontend({ stateManagement: { server: "native-fetch", generateHooks: false } }),
      api: {
        ...context.api,
        endpoints: [
          {
            ...listOrders,
            method: "POST" as const,
            entity: "EditableRecord",
            operationId: "createEditableRecord",
          },
          {
            ...listOrders,
            method: "PATCH" as const,
            entity: "EditableRecord",
            operationId: "updateEditableRecord",
            path: "/editable-record",
            pathParams: [],
          },
          {
            ...listOrders,
            method: "DELETE" as const,
            entity: "EditableRecord",
            operationId: "deleteEditableRecord",
            path: "/editable-record",
            pathParams: [],
          },
        ],
        entities: {},
      },
    });
    expect(inferredPathParameters[0]?.content).toContain('path: { "id": id }');

    const deleteOnly = generateFeatureScreenFiles({
      ...context,
      api: {
        ...context.api,
        endpoints: [
          {
            ...listOrders,
            method: "DELETE" as const,
            entity: "RemovableRecord",
            operationId: "deleteRemovableRecord",
            pathParams: [],
          },
        ],
        entities: {},
      },
    });
    expect(deleteOnly[0]?.content).toContain("Delete RemovableRecord");

    const wrongScreensPlugin: FrontendGeneratorPlugin = {
      ...featureScreensFrontendPlugin,
      descriptor: { ...featureScreensFrontendPlugin.descriptor, role: "ui" },
    };
    const wrongScreens = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
        wrongScreensPlugin,
      ),
      { endpoints, entities: apiContract.entities, enums: apiContract.enums },
    );
    expect(wrongScreens.success).toBe(false);
    if (!wrongScreens.success)
      expect(wrongScreens.diagnostics.map(({ code }) => code)).toContain(
        "FRONTEND_FEATURE_SCREENS_PLUGIN_ROLE_MISMATCH",
      );

    const composition = composeFrontendPlugins(
      "Shop",
      frontend(),
      registryWith(
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
        featureScreensFrontendPlugin,
      ),
      { endpoints, entities: apiContract.entities, enums: apiContract.enums },
    );
    expect(composition.success).toBe(true);
  });
});
