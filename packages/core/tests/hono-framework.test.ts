import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { cleanArchitecturePlugin } from "../src/plugins/architecture/clean.js";
import { composeBackendPlugins, composePlugins } from "../src/plugins/composer.js";
import { generateHonoFiles } from "../src/plugins/frameworks/hono-files.js";
import { honoFrameworkPlugin } from "../src/plugins/frameworks/hono.js";
import { drizzleOrmPlugin } from "../src/plugins/orms/drizzle.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { createValidConfig } from "./fixtures.js";

function composeHono(applicationRoot: string) {
  const registry = new PluginRegistry();
  registry.register(honoFrameworkPlugin);
  registry.register(cleanArchitecturePlugin);
  return composePlugins({
    registry,
    selections: [{ pluginId: "hono", configuration: { applicationRoot } }, { pluginId: "clean" }],
  });
}

describe("Hono framework plugin", () => {
  it("provides a Cloudflare Workers context and official Hono scaffold plan", () => {
    const result = composeHono("apps/api");
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.frameworkContext).toMatchObject({
      applicationRoot: "apps/api",
      codeRoot: "apps/api/src",
      language: "typescript",
      runtime: "cloudflare-workers",
      moduleSystem: "esm",
      scaffold: {
        executable: "pnpm",
        argumentsBeforeTarget: ["create", "hono@0.19.4"],
        argumentsAfterTarget: ["--template", "cloudflare-workers", "--pm", "pnpm", "--install"],
      },
      entryPoints: { worker: "apps/api/src/index.ts" },
      conventions: { importExtension: ".js", sourceExtension: ".ts", moduleKind: "esm" },
    });
  });

  it("generates Hono controllers, route registration, and bootstrap imports under the app source root", () => {
    const result = composeHono("packages/services/api");
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    expect(Object.keys(files)).toEqual([
      "packages/services/api/src/index.ts",
      "packages/services/api/src/presentation/controllers/health.controller.ts",
      "packages/services/api/src/presentation/controllers/routes.ts",
    ]);
    expect(files["packages/services/api/src/index.ts"]).toContain(
      'from "./presentation/controllers/routes.js"',
    );
    expect(files["packages/services/api/src/presentation/controllers/routes.ts"]).toContain(
      'from "./health.controller.js"',
    );
    expect(files["packages/services/api/src/presentation/controllers/routes.ts"]).toContain(
      'routes.route("/health", healthController);',
    );
    expect(
      files["packages/services/api/src/presentation/controllers/health.controller.ts"],
    ).toContain('healthController.get("/", (context) => context.json({ status: "ok" }));');
  });

  it("rejects a missing application root before contributing files", () => {
    const registry = new PluginRegistry();
    registry.register(honoFrameworkPlugin);
    registry.register(cleanArchitecturePlugin);
    const result = composePlugins({
      registry,
      selections: [{ pluginId: "hono" }, { pluginId: "clean" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
    );
  });

  it("rejects a context without the worker entry point", () => {
    const registry = new PluginRegistry();
    registry.register({
      ...honoFrameworkPlugin,
      createFrameworkContext: () =>
        ({
          ...honoFrameworkPlugin.createFrameworkContext?.({
            pluginId: "hono",
            configuration: { applicationRoot: "apps/api" },
          }),
          entryPoints: {},
        }) as NonNullable<ReturnType<typeof honoFrameworkPlugin.createFrameworkContext>>,
    });
    registry.register(cleanArchitecturePlugin);
    const result = composePlugins({
      registry,
      selections: [
        { pluginId: "hono", configuration: { applicationRoot: "apps/api" } },
        { pluginId: "clean" },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CONTRIBUTION_FAILED", path: "plugins.hono" }),
    );
  });

  it("generates the framework-only bootstrap when no auth or ORM is selected", () => {
    const selection = { pluginId: "hono", configuration: { applicationRoot: "apps/api" } };
    const framework = honoFrameworkPlugin.createFrameworkContext?.(selection);
    if (!framework) throw new Error("Hono framework context is unavailable.");
    const architecture = cleanArchitecturePlugin.resolveArchitectureLayout?.(framework, {
      pluginId: "clean",
    });
    if (!architecture) throw new Error("Clean architecture layout is unavailable.");

    const files = generateHonoFiles({
      selection,
      framework,
      architecture,
      availableCapabilities: new Set(),
      domainModel: { entities: {}, enums: {}, endpoints: [] },
    });
    const entrypoint = files.find((file) => file.path === "apps/api/src/index.ts")?.content;

    expect(entrypoint).toContain('import routes from "./presentation/controllers/routes.js"');
    expect(entrypoint).toContain("const app = new Hono();");
    expect(entrypoint).toContain('app.route("/", routes);');
  });

  it("declares hono and @hono/zod-validator runtime dependencies", () => {
    expect(honoFrameworkPlugin.descriptor.dependencies).toEqual({
      hono: "^4.7.2",
      "@hono/zod-validator": "^0.4.3",
    });
  });

  it("generates only declared business controllers and RFC 7807 error handling", () => {
    const config = createValidConfig();
    config.endpoints.push({
      backend: "core-api",
      path: "/",
      method: "GET",
      operationId: "getRoot",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      joins: [],
    });
    config.endpoints.push({
      backend: "core-api",
      path: "/api/orders/create-custom",
      method: "POST",
      operationId: "createCustomOrder",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      requestBody: {
        total: { type: "number", required: true },
      },
      joins: [],
    });

    const registry = new PluginRegistry();
    registry.register(honoFrameworkPlugin);
    registry.register(cleanArchitecturePlugin);
    registry.register(drizzleOrmPlugin);

    const result = composeBackendPlugins(NordixConfigSchema.parse(config), "core-api", registry);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    const root = "apps/api-core/src";

    // 1. Problem details helper
    expect(files[`${root}/presentation/problem-details.ts`]).toBeDefined();
    expect(files[`${root}/presentation/problem-details.ts`]).toContain(
      "export function problemResponse(",
    );
    expect(files[`${root}/presentation/problem-details.ts`]).toContain("application/problem+json");

    // Entities keep domain/persistence artifacts without gaining HTTP controllers.
    for (const entity of ["order", "user", "orderitem"]) {
      expect(files[`${root}/presentation/controllers/${entity}.controller.ts`]).toBeUndefined();
    }

    // 3. Custom endpoint controllers
    const summaryController =
      files[`${root}/presentation/controllers/getOrderSummary.controller.ts`];
    expect(summaryController).toBeDefined();
    expect(summaryController).toContain("import { QueryParamsSchema } from");
    expect(summaryController).toContain("import { GetOrderSummaryUseCase } from");
    expect(summaryController).toContain("router.get(");
    expect(summaryController).toContain('"/api/orders/summary"');

    const customController =
      files[`${root}/presentation/controllers/createCustomOrder.controller.ts`];
    expect(customController).toBeDefined();
    expect(customController).toContain("router.post(");
    expect(customController).toContain('"/api/orders/create-custom"');

    // Endpoint without operationId and root path
    const fallbackController = files[`${root}/presentation/controllers/getRoot.controller.ts`];
    expect(fallbackController).toBeDefined();

    // 4. Routes aggregator
    const routes = files[`${root}/presentation/controllers/routes.ts`];
    expect(routes).toBeDefined();
    expect(routes).toContain('routes.route("/health", healthController);');
    expect(routes).not.toContain('routes.route("/orders"');
    expect(routes).not.toContain('routes.route("/users"');
    expect(routes).toContain('routes.route("/",');
    expect(routes).toContain("export function createRoutes(");

    // 5. Entry point with RFC 7807 error and notFound handlers
    const index = files[`${root}/index.ts`];
    expect(index).toBeDefined();
    expect(index).toContain("app.onError((");
    expect(index).toContain("app.notFound((");
    expect(index).toContain('problemResponse(c, 500, "Internal Server Error"');
    expect(index).toContain('problemResponse(c, 404, "Not Found"');
    expect(index).toContain("createRouteDependencies(c.env.DATABASE_URL)");

    // 6. Dependencies merged in result
    expect(result.runtimeDependencies).toMatchObject({
      hono: "^4.7.2",
      "@hono/zod-validator": "^0.4.3",
    });
  });
});
