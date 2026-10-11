import { describe, expect, it } from "vitest";
import { FrontendSchema, NordixConfigSchema } from "../src/configuration/schema.js";
import {
  type FrontendGeneratorPlugin,
  FrontendPluginRegistrationError,
  FrontendPluginRegistry,
  buildFrontendApiContract,
  composeFrontendPlugins,
  nativeReactUiPlugin,
  nextjsFrontendPlugin,
  plainCssStylingPlugin,
  swrServerStatePlugin,
  tailwindStylingPlugin,
  tanstackQueryServerStatePlugin,
  typedFetchApiPlugin,
  validateFrontendPluginDescriptor,
} from "../src/index.js";

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

  it("limits normalized API contracts to the frontend's connected backends", () => {
    const config = NordixConfigSchema.parse({
      name: "commerce",
      version: "1.0.0",
      repositories: [{ name: "app", path: "." }],
      backends: [
        { name: "api", framework: "hono", repository: "app", path: "apps/api" },
        { name: "admin", framework: "hono", repository: "app", path: "apps/admin" },
      ],
      entities: {
        Order: {
          backend: "api",
          relations: { user: { type: "many-to-one", target: "User", foreignKey: "userId" } },
        },
        User: { backend: "api" },
        AuditLog: { backend: "admin" },
      },
      endpoints: [
        { backend: "api", path: "/orders", method: "GET", entity: "Order" },
        { backend: "admin", path: "/audit-logs", method: "GET", entity: "AuditLog" },
      ],
    });
    const contract = buildFrontendApiContract(config, frontend({ connectsTo: ["api"] }));
    expect(contract.endpoints.map((endpoint) => endpoint.path)).toEqual(["/orders"]);
    expect(contract.entities).not.toHaveProperty("AuditLog");
    expect(contract.entities.Order?.fields).toHaveProperty("userId");
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
  });

  it("generates selected server-state integrations and their runtime dependencies", () => {
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
      ),
      apiContract,
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
      ),
      apiContract,
    );
    expect(swr.success).toBe(true);
    if (!swr.success) return;
    expect(swr.runtimeDependencies).toMatchObject({ swr: "^2.3.3" });
    expect(swr.virtualFileSystem.readFile("apps/store-web/src/lib/api/hooks.ts")).toContain(
      "useSWR",
    );
    expect(swr.virtualFileSystem.listFiles()).not.toContain("apps/store-web/src/app/providers.tsx");
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
});
