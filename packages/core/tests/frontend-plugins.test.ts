import ts from "typescript";
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
import { frontendRenderSettings } from "../src/plugins/frontend-api-contract.js";
import { generateFeatureScreenFiles } from "../src/plugins/frontends/feature-screens.js";
import { frontendRootShellOwnerRole } from "../src/plugins/frontends/root-shell.js";
import { createValidConfig, resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedTypeErrors } from "./generated-types.js";

const frontend = (options: Record<string, unknown> = {}) => ({
  ...frontendRenderSettings(resolvedFixture(createValidConfig()), "store-web"),
  ...options,
  stateManagement:
    typeof options.stateManagement === "object"
      ? {
          client: "zustand",
          server: "tanstack-query",
          generateHooks: true,
          optimisticUpdates: false,
          ...options.stateManagement,
        }
      : undefined,
});

function registryWith(...plugins: FrontendGeneratorPlugin[]) {
  const registry = new FrontendPluginRegistry();
  for (const plugin of plugins) registry.register(plugin);
  return registry;
}

describe("frontend plugin contracts", () => {
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
    const settings = frontendRenderSettings(project, "store-web");
    const framework = nextjsFrontendPlugin.createFrameworkContext?.(settings);
    if (!framework) throw new Error("Missing frontend framework fixture");
    const output = typedFetchApiPlugin.contribute({
      projectName: "Shop",
      frontend: settings,
      framework,
      api: buildFrontendApiContract(project, "store-web"),
      availableCapabilities: new Set(),
    });
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
  const apiContract = buildFrontendApiContract(resolvedFixture(apiConfiguration()), "store-web");
  const orderEndpoint = apiContract.endpoints.find(
    (endpoint) => endpoint.operationId === "getOrder",
  );
  const updateEndpoint = apiContract.endpoints.find(
    (endpoint) => endpoint.operationId === "updateUser",
  );
  if (!orderEndpoint || !updateEndpoint) throw new Error("API test fixtures are incomplete.");
  it("renders empty create bodies and empty join projections without inventing private fields", () => {
    const config = apiConfiguration();
    config.entities.EmptyRecord = { backend: "api", fields: {} };
    config.backends[0].modules.orders.entities.push("EmptyRecord");
    config.endpoints[1].joins[0].fields = [];
    config.endpoints[1].pagination = undefined;
    config.endpoints.push({
      backend: "api",
      entity: "EmptyRecord",
      operationId: "createEmpty",
      method: "POST",
      path: "/empty",
      requestBody: { useCase: { entity: "EmptyRecord", operation: "create" } },
    });
    const project = resolvedFixture(config);
    const settings = frontendRenderSettings(project, "store-web");
    const framework = nextjsFrontendPlugin.createFrameworkContext?.(settings);
    if (!framework) throw new Error("Missing frontend framework");
    const api = buildFrontendApiContract(project, "store-web");
    const files = typedFetchApiPlugin.contribute({
      projectName: "Shop",
      frontend: settings,
      framework,
      api,
      availableCapabilities: new Set(),
    });
    const types = files.find((file) => file.path.endsWith("/types.ts"))?.content;
    expect(types).toContain("export type createEmptyBody = Record<string, never>");
    expect(types).toContain('"User": {  } | null');
    const registry = registryWith(
      nextjsFrontendPlugin,
      tailwindStylingPlugin,
      nativeReactUiPlugin,
      typedFetchApiPlugin,
      {
        ...featureScreensFrontendPlugin,
        descriptor: { ...featureScreensFrontendPlugin.descriptor, role: "ui" },
      },
    );
    const result = composeFrontendPlugins(
      "Shop",
      { ...settings, stateManagement: undefined },
      registry,
      api,
    );
    expect(result).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "FRONTEND_FEATURE_SCREENS_PLUGIN_ROLE_MISMATCH" }),
      ]),
    });
  });

  it.each(["tanstack-query", "swr", "native-fetch"])(
    "renders declared CRUD, query and cache contracts using %s",
    (server) => {
      const config = targetConfig();
      config.enums.Status = ["active", "disabled"];
      Object.assign(config.entities.Customer.fields, {
        count: { type: "number", required: true, unique: false },
        enabled: { type: "boolean", required: true, unique: false, default: false },
        status: { type: "enum", enumName: "Status", required: true, unique: false },
        details: { type: "json", required: false, unique: false },
        bornAt: { type: "date", required: false, unique: false },
        externalId: { type: "uuid", required: false, unique: false },
        label: { type: "string", required: false, unique: false, default: "Draft" },
      });
      config.endpoints[0].queryParams[0].name = "search";
      const project = resolvedFixture(config);
      const settings = {
        ...frontendRenderSettings(project, "web"),
        stateManagement: {
          client: "zustand",
          server,
          generateHooks: server !== "native-fetch",
          optimisticUpdates: true,
        },
      };
      const result = composeFrontendPlugins(
        "Shop",
        settings,
        registryWith(
          nextjsFrontendPlugin,
          tailwindStylingPlugin,
          nativeReactUiPlugin,
          typedFetchApiPlugin,
          featureScreensFrontendPlugin,
          tanstackQueryServerStatePlugin,
          swrServerStatePlugin,
          zustandClientStatePlugin,
          betterAuthFrontendPlugin,
        ),
        buildFrontendApiContract(project, "web"),
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      const files = result.virtualFileSystem.snapshot();
      const page = files["apps/web/src/components/features/customer-screen.tsx"];
      expect(page).toContain("createCustomer");
      expect(page).toContain("deleteCustomer");
      expect(page).toContain("updateCustomer");
      expect(page).toContain('type="checkbox"');
      expect(page).toContain('type="number"');
      expect(page).toContain('type="date"');
      expect(page).toContain("hasPermission");
      expect(page).toContain("searchFilter");
      expect(files["apps/web/src/components/features/invoice-screen.tsx"]).toContain(
        "No delete endpoint",
      );
      if (server === "tanstack-query") {
        const hooks = files["apps/web/src/lib/api/hooks.ts"];
        expect(hooks).toContain("onMutate");
        expect(hooks).toContain('input.path?.["customerId"]');
        expect(hooks).toContain("previous");
      } else if (server === "swr") {
        expect(files["apps/web/src/lib/api/hooks.ts"]).toContain("useSWRMutation");
      } else expect(files["apps/web/src/lib/api/hooks.ts"]).toBeUndefined();
    },
  );

  it.each([false, "boolean", "timestamp"])(
    "renders only declared writable operations with soft-delete strategy %s",
    (softDelete) => {
      const config = apiConfiguration();
      config.entities.User.softDelete = softDelete;
      config.endpoints.push(
        {
          backend: "api",
          entity: "User",
          operationId: "createUser",
          method: "POST",
          path: "/users",
          requestBody: { useCase: { entity: "User", operation: "create" } },
        },
        {
          backend: "api",
          entity: "User",
          operationId: "deleteUser",
          method: "DELETE",
          path: "/users/{id}",
          pathParams: [{ name: "id", field: { entity: "User", field: "id" } }],
        },
        {
          backend: "api",
          entity: "Order",
          operationId: "customOrder",
          method: "POST",
          path: "/orders/custom",
          requestBody: { title: { type: "string" } },
        },
      );
      const project = resolvedFixture(config);
      expect(project.frontends["store-web"].features.Order.create).toBeUndefined();
      const settings = {
        ...frontendRenderSettings(project, "store-web"),
        stateManagement: undefined,
      };
      const framework = nextjsFrontendPlugin.createFrameworkContext?.(settings);
      if (!framework) throw new Error("Missing framework fixture");
      const api = buildFrontendApiContract(project, "store-web");
      const files = generateFeatureScreenFiles({
        projectName: "Shop",
        frontend: settings,
        framework,
        api,
        availableCapabilities: new Set(),
      });
      const page = files.find((file) => file.path.endsWith("user-screen.tsx"))?.content;
      expect(page).toContain("createUser");
      expect(page).toContain("deleteUser");
      expect(page).toContain(
        softDelete === false
          ? "permanently removes"
          : softDelete === "boolean"
            ? "marked inactive"
            : "archived",
      );
      expect(page).not.toContain("hasPermission");
      const direct = {
        projectName: "Shop",
        frontend: settings,
        framework,
        api,
        availableCapabilities: new Set<string>(),
      };
      expect(tanstackQueryServerStatePlugin.contribute(direct)).toEqual([]);
      expect(swrServerStatePlugin.contribute(direct)).toEqual([]);
      expect(
        generateFeatureScreenFiles({ ...direct, api: { ...api, endpoints: [], features: {} } }),
      ).toEqual([]);
    },
  );

  it("limits API contracts to connected declared operations and the selected authority", () => {
    const config = targetConfig();
    const project = resolvedFixture(config);
    const contract = buildFrontendApiContract(project, "web");
    expect(contract.endpoints).toHaveLength(config.endpoints.length);
    expect(contract.entities.CustomerAddress).toBeUndefined();
    expect(contract.authentication).toMatchObject({
      plugin: "better-auth",
      backend: "api",
      roles: ["admin", "viewer"],
    });
    config.frontends[0].connectsTo = [];
    config.frontends[0].access = { mode: "public" };
    const disconnected = buildFrontendApiContract(resolvedFixture(config), "web");
    expect(disconnected.endpoints).toEqual([]);
    expect(disconnected.entities).toEqual({});
    expect(disconnected.authentication).toBeUndefined();
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
    expect(types).toContain('"User": { readonly "name": string } | null;');
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

    const config = apiConfiguration();
    config.endpoints.push({
      backend: "api",
      entity: "Order",
      operationId: "showExamples",
      method: "POST",
      path: "/orders/examples",
      requestBody: {
        count: { type: "number" },
        active: { type: "boolean" },
        details: { type: "json" },
        status: { type: "enum", enumName: "OrderStatus" },
        title: { type: "string", default: "Draft" },
        created: { type: "date", default: { kind: "now" } },
      },
    });
    const project = resolvedFixture(config);
    const apiFramework = nextjsFrontendPlugin.createFrameworkContext?.(frontend());
    if (!apiFramework) throw new Error("Missing framework fixture");
    const bodyExamples = typedFetchApiPlugin.contribute({
      projectName: "Commerce",
      frontend: frontend(),
      framework: apiFramework,
      availableCapabilities: new Set(),
      api: buildFrontendApiContract(project, "store-web"),
    });
    const bodyExplorer = bodyExamples.find((file) =>
      file.path.endsWith("api-explorer.tsx"),
    )?.content;
    expect(bodyExplorer).toContain('"count": 0');
    expect(bodyExplorer).toContain('"active": false');
    expect(bodyExplorer).toContain('"details": {}');
    expect(bodyExplorer).toContain('"status": "pending"');
    expect(bodyExplorer).toContain('"title": "Draft"');
    expect(bodyExplorer).not.toContain('"kind": "now"');
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
      api: { endpoints: [], operationNames: {}, features: {}, entities: {}, enums: {} },
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
      api: { endpoints: [], operationNames: {}, features: {}, entities: {}, enums: {} },
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
    expect(result.virtualFileSystem.readFile("apps/store-web/src/app/page.tsx")).not.toContain(
      "<AuthControls />",
    );
    const layout = result.virtualFileSystem.readFile("apps/store-web/src/app/layout.tsx");
    expect(layout).toContain('import { AuthControls } from "@/components/auth/auth-controls";');
    expect(layout).toContain('<div className="ng-session-indicator"><AuthControls /></div>');
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/auth-controls.tsx"),
    ).toContain("<SignOutButton />");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-up-form.tsx"),
    ).toContain("authClient.signUp.email");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-up-form.tsx"),
    ).toContain("await authClient.getSession();");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-up-form.tsx"),
    ).toContain("minLength={4}");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-up-form.tsx"),
    ).toContain("Could not reach the authentication server.");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-in-form.tsx"),
    ).toContain("Could not reach the authentication server.");
    expect(
      result.virtualFileSystem.readFile("apps/store-web/src/components/auth/sign-in-form.tsx"),
    ).toContain("await authClient.getSession();");
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

  it("checks authentication renderer boundaries", () => {
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
        api: { endpoints: [], operationNames: {}, features: {}, entities: {}, enums: {} },
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
});
