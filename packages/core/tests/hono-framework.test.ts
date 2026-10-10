import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { cleanArchitecturePlugin } from "../src/plugins/architecture/clean.js";
import { generateHonoFiles } from "../src/plugins/frameworks/hono-files.js";
import { composeBackendPlugins, composePlugins } from "../src/plugins/composer.js";
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

  it("generates modular entity controllers, custom endpoint controllers, and RFC 7807 error handling", () => {
    const config = createValidConfig();
    config.endpoints.push({
      backend: "core-api",
      path: "/",
      method: "GET",
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

    // 2. Entity controllers
    const orderController = files[`${root}/presentation/controllers/order.controller.ts`];
    expect(orderController).toBeDefined();
    expect(orderController).toContain('import { zValidator } from "@hono/zod-validator";');
    expect(orderController).toContain(
      "import { CreateOrderSchema, UpdateOrderSchema, OrderIdSchema }",
    );
    expect(orderController).toContain("export function createOrderController(");
    expect(orderController).toContain("router.post(");
    expect(orderController).toContain("router.get(");
    expect(orderController).toContain("router.patch(");
    expect(orderController).toContain("router.delete(");
    expect(orderController).toContain('problemResponse(c, 400, "Validation Failed"');
    expect(orderController).toContain('problemResponse(c, 404, "Not Found"');

    const userController = files[`${root}/presentation/controllers/user.controller.ts`];
    expect(userController).toBeDefined();
    expect(userController).toContain("export function createUserController(");

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
    const fallbackController = files[`${root}/presentation/controllers/getEndpoint.controller.ts`];
    expect(fallbackController).toBeDefined();

    // 4. Routes aggregator
    const routes = files[`${root}/presentation/controllers/routes.ts`];
    expect(routes).toBeDefined();
    expect(routes).toContain('routes.route("/health", healthController);');
    expect(routes).toContain('routes.route("/orders"');
    expect(routes).toContain('routes.route("/users"');
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

  it("handles HTTP request validation, status codes, and RFC 7807 responses end-to-end", async () => {
    // Problem response helper matching generated code
    function problemResponse(
      c: Context,
      status: number,
      title: string,
      detail?: string,
      errors?: unknown,
      type = "https://tools.ietf.org/html/rfc7807",
    ) {
      return c.json(
        {
          type,
          title,
          status,
          ...(detail !== undefined ? { detail } : {}),
          instance: c.req.path,
          ...(errors !== undefined ? { errors } : {}),
        },
        status as never,
        { "Content-Type": "application/problem+json" },
      );
    }

    const OrderIdSchema = z.string().uuid();
    const CreateOrderSchema = z.object({
      status: z.enum(["pending", "completed"]),
      total: z.number().positive(),
    });
    const UpdateOrderSchema = CreateOrderSchema.partial();

    // In-memory use cases
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    const notFoundUuid = "123e4567-e89b-12d3-a456-426614174999";

    const mockCreateUseCase = {
      execute: async (input: unknown) => ({ id: validUuid, ...(input as Record<string, unknown>) }),
    };
    const mockGetUseCase = {
      execute: async (id: string) =>
        id === validUuid ? { id: validUuid, status: "pending", total: 100 } : null,
    };
    const mockListUseCase = {
      execute: async (_input: unknown) => [{ id: validUuid, status: "pending", total: 100 }],
    };
    const mockUpdateUseCase = {
      execute: async ({ id, changes }: { id: string; changes: unknown }) =>
        id === validUuid
          ? {
              id: validUuid,
              status: "completed",
              total: 100,
              ...(changes as Record<string, unknown>),
            }
          : null,
    };
    const mockDeleteUseCase = {
      execute: async (_id: string) => undefined,
    };

    interface OrderRouterDeps {
      createUseCase?: { execute: (input: unknown) => Promise<unknown> };
      getUseCase?: { execute: (id: string) => Promise<unknown | null> };
      listUseCase?: { execute: (input: unknown) => Promise<readonly unknown[]> };
      updateUseCase?: {
        execute: (input: { id: string; changes: unknown }) => Promise<unknown | null>;
      };
      deleteUseCase?: { execute: (id: string) => Promise<void> };
    }

    function createOrderRouter(deps?: OrderRouterDeps) {
      const router = new Hono();

      router.post(
        "/",
        zValidator("json", CreateOrderSchema, (result, c) => {
          if (!result.success) {
            return problemResponse(
              c,
              400,
              "Validation Failed",
              "Request body validation failed",
              result.error.issues,
            );
          }
        }),
        async (c) => {
          const input = c.req.valid("json");
          const useCase = deps?.createUseCase;
          if (!useCase) {
            return problemResponse(
              c,
              500,
              "Internal Server Error",
              "CreateOrderUseCase not configured",
            );
          }
          const entity = await useCase.execute(input);
          return c.json(entity, 201);
        },
      );

      router.get("/", async (c) => {
        const useCase = deps?.listUseCase;
        if (!useCase) {
          return problemResponse(
            c,
            500,
            "Internal Server Error",
            "ListOrderUseCase not configured",
          );
        }
        const filter = c.req.query();
        const result = await useCase.execute({ filter });
        return c.json(result, 200);
      });

      router.get(
        "/:id",
        zValidator("param", z.object({ id: OrderIdSchema }), (result, c) => {
          if (!result.success) {
            return problemResponse(
              c,
              400,
              "Validation Failed",
              "Invalid parameter: id",
              result.error.issues,
            );
          }
        }),
        async (c) => {
          const { id } = c.req.valid("param");
          const useCase = deps?.getUseCase;
          if (!useCase) {
            return problemResponse(
              c,
              500,
              "Internal Server Error",
              "GetOrderUseCase not configured",
            );
          }
          const entity = await useCase.execute(id);
          if (!entity) {
            return problemResponse(c, 404, "Not Found", "Order not found");
          }
          return c.json(entity, 200);
        },
      );

      router.patch(
        "/:id",
        zValidator("param", z.object({ id: OrderIdSchema }), (result, c) => {
          if (!result.success) {
            return problemResponse(
              c,
              400,
              "Validation Failed",
              "Invalid parameter: id",
              result.error.issues,
            );
          }
        }),
        zValidator("json", UpdateOrderSchema, (result, c) => {
          if (!result.success) {
            return problemResponse(
              c,
              400,
              "Validation Failed",
              "Request body validation failed",
              result.error.issues,
            );
          }
        }),
        async (c) => {
          const { id } = c.req.valid("param");
          const changes = c.req.valid("json");
          const useCase = deps?.updateUseCase;
          if (!useCase) {
            return problemResponse(
              c,
              500,
              "Internal Server Error",
              "UpdateOrderUseCase not configured",
            );
          }
          const updated = await useCase.execute({ id, changes });
          if (!updated) {
            return problemResponse(c, 404, "Not Found", "Order not found");
          }
          return c.json(updated, 200);
        },
      );

      router.delete(
        "/:id",
        zValidator("param", z.object({ id: OrderIdSchema }), (result, c) => {
          if (!result.success) {
            return problemResponse(
              c,
              400,
              "Validation Failed",
              "Invalid parameter: id",
              result.error.issues,
            );
          }
        }),
        async (c) => {
          const { id } = c.req.valid("param");
          const useCase = deps?.deleteUseCase;
          if (!useCase) {
            return problemResponse(
              c,
              500,
              "Internal Server Error",
              "DeleteOrderUseCase not configured",
            );
          }
          await useCase.execute(id);
          return c.body(null, 204);
        },
      );

      return router;
    }

    // Custom joined endpoint
    const QueryParamsSchema = z.object({
      orderStatus: z.enum(["pending", "completed"]).optional(),
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().positive().max(100).default(20),
    });

    interface SummaryRouterDeps {
      useCase?: {
        execute: (input: {
          path: Record<string, string>;
          query: Record<string, unknown>;
        }) => Promise<unknown>;
      };
    }

    function createSummaryRouter(deps?: SummaryRouterDeps) {
      const router = new Hono();
      router.get(
        "/api/orders/summary",
        zValidator("query", QueryParamsSchema, (result, c) => {
          if (!result.success) {
            return problemResponse(
              c,
              400,
              "Validation Failed",
              "Invalid query parameters",
              result.error.issues,
            );
          }
        }),
        async (c) => {
          const useCase = deps?.useCase;
          if (!useCase) {
            return problemResponse(
              c,
              500,
              "Internal Server Error",
              "GetOrderSummaryUseCase not configured",
            );
          }
          const query = c.req.valid("query");
          const response = await useCase.execute({ path: {}, query });
          return c.json(response, 200);
        },
      );
      return router;
    }

    const app = new Hono();
    app.onError((err, c) => problemResponse(c, 500, "Internal Server Error", err.message));
    app.notFound((c) => problemResponse(c, 404, "Not Found", `Route not found: ${c.req.path}`));

    const orderRouter = createOrderRouter({
      createUseCase: mockCreateUseCase,
      getUseCase: mockGetUseCase,
      listUseCase: mockListUseCase,
      updateUseCase: mockUpdateUseCase,
      deleteUseCase: mockDeleteUseCase,
    });
    const summaryRouter = createSummaryRouter({
      useCase: {
        execute: async ({
          query,
        }: { path: Record<string, string>; query: Record<string, unknown> }) => ({
          items: [{ entity: { id: validUuid }, joins: { User: { email: "test@example.com" } } }],
          total: 1,
          page: query.page,
          pageSize: query.pageSize,
        }),
      },
    });

    app.route("/orders", orderRouter);
    app.route("/", summaryRouter);

    // 1. POST /orders - valid
    const postRes = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "pending", total: 42 }),
    });
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json();
    expect(postBody).toMatchObject({ id: validUuid, status: "pending", total: 42 });

    // 2. POST /orders - invalid (RFC 7807 400)
    const postInvalidRes = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "invalid_status", total: -5 }),
    });
    expect(postInvalidRes.status).toBe(400);
    expect(postInvalidRes.headers.get("Content-Type")).toBe("application/problem+json");
    const postInvalidBody = await postInvalidRes.json();
    expect(postInvalidBody.title).toBe("Validation Failed");
    expect(postInvalidBody.status).toBe(400);
    expect(postInvalidBody.errors).toBeDefined();

    // 3. GET /orders - list
    const listRes = await app.request("/orders");
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(Array.isArray(listBody)).toBe(true);

    // 4. GET /orders/:id - valid found
    const getRes = await app.request(`/orders/${validUuid}`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.id).toBe(validUuid);

    // 5. GET /orders/:id - valid not found (RFC 7807 404)
    const getNotFoundRes = await app.request(`/orders/${notFoundUuid}`);
    expect(getNotFoundRes.status).toBe(404);
    expect(getNotFoundRes.headers.get("Content-Type")).toBe("application/problem+json");
    const getNotFoundBody = await getNotFoundRes.json();
    expect(getNotFoundBody.title).toBe("Not Found");

    // 6. GET /orders/:id - invalid UUID (RFC 7807 400)
    const getInvalidIdRes = await app.request("/orders/not-a-uuid");
    expect(getInvalidIdRes.status).toBe(400);
    expect(getInvalidIdRes.headers.get("Content-Type")).toBe("application/problem+json");

    // 7. PATCH /orders/:id - valid
    const patchRes = await app.request(`/orders/${validUuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    expect(patchRes.status).toBe(200);

    // 8. PATCH /orders/:id - not found
    const patchNotFoundRes = await app.request(`/orders/${notFoundUuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    expect(patchNotFoundRes.status).toBe(404);

    // 9. DELETE /orders/:id - valid
    const deleteRes = await app.request(`/orders/${validUuid}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    // 10. Custom joined endpoint - valid
    const summaryRes = await app.request(
      "/api/orders/summary?orderStatus=pending&page=1&pageSize=20",
    );
    expect(summaryRes.status).toBe(200);
    const summaryBody = await summaryRes.json();
    expect(summaryBody.total).toBe(1);
    expect(summaryBody.items[0].joins.User.email).toBe("test@example.com");

    // 11. Custom joined endpoint - invalid query
    const summaryInvalidRes = await app.request("/api/orders/summary?pageSize=999");
    expect(summaryInvalidRes.status).toBe(400);
    expect(summaryInvalidRes.headers.get("Content-Type")).toBe("application/problem+json");

    // 12. Unconfigured useCase - 500 RFC 7807
    const unconfiguredRouter = createOrderRouter();
    const unconfiguredApp = new Hono();
    unconfiguredApp.route("/orders", unconfiguredRouter);
    const unconfiguredRes = await unconfiguredApp.request(`/orders/${validUuid}`);
    expect(unconfiguredRes.status).toBe(500);
    expect(unconfiguredRes.headers.get("Content-Type")).toBe("application/problem+json");

    // 13. Route not found - 404 RFC 7807
    const notFoundRouteRes = await app.request("/non-existent-route");
    expect(notFoundRouteRes.status).toBe(404);
    expect(notFoundRouteRes.headers.get("Content-Type")).toBe("application/problem+json");
  });
});
