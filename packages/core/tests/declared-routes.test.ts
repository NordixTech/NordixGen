import { posix } from "node:path";
import * as validator from "@hono/zod-validator";
import * as hono from "hono";
import * as cors from "hono/cors";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import {
  FrontendPluginRegistry,
  PluginRegistry,
  betterAuthFrontendPlugin,
  betterAuthPlugin,
  buildFrontendApiContract,
  cleanArchitecturePlugin,
  composeBackendPlugins,
  composeFrontendPlugins,
  drizzleOrmPlugin,
  featureScreensFrontendPlugin,
  honoFrameworkPlugin,
  nativeReactUiPlugin,
  nextjsFrontendPlugin,
  parseNordixYaml,
  rbacPbacPlugin,
  tailwindStylingPlugin,
  tanstackQueryServerStatePlugin,
  typedFetchApiPlugin,
  zustandClientStatePlugin,
} from "../src/index.js";

function configuration(withEndpoints = true, createPath = "/api/sample-items") {
  const parsed = parseNordixYaml(`
name: declared-routes
version: 1.0.0
repositories: [{ name: app, path: . }]
databases:
  primary: { engine: postgres, provider: neon }
backends:
  - name: api
    framework: hono
    architecture: clean
    repository: app
    path: apps/api
    persistence: { database: primary, orm: drizzle }
    authentication: { plugin: better-auth, methods: [email-password] }
    authorization:
      roles: [editor, viewer, outsider]
      defaultRole: viewer
      rolePermissions:
        editor: [sample-items:create, sample-items:read]
        viewer: [sample-items:read]
        outsider: [sample-items:create]
frontends:
  - name: web
    framework: nextjs
    repository: app
    path: apps/web
    connectsTo: [api]
    stateManagement: { server: tanstack-query, generateHooks: true }
entities:
  SampleItem:
    backend: api
    fields:
      name: { type: string }
  PrivateRecord:
    backend: api
    fields:
      title: { type: string }
${
  withEndpoints
    ? `endpoints:
  - backend: api
    operationId: createSampleItem
    method: POST
    path: ${createPath}
    entity: SampleItem
    roles: [editor, viewer]
    permissions: [sample-items:create]
    requestBody: { useCase: { entity: SampleItem, operation: create } }
  - backend: api
    operationId: listSampleItems
    method: GET
    path: /api/sample-items
    entity: SampleItem
    authRequired: false
    queryParams:
      - name: name
        field: { entity: SampleItem, field: name }
        required: false
    pagination: standard
  - backend: api
    operationId: getSampleItem
    method: GET
    path: /api/sample-items/{id}
    entity: SampleItem
    authRequired: false
    pathParams:
      - name: id
        field: { entity: SampleItem, field: id }
pagination:
  standard: { strategy: offset, defaultPageSize: 2, maxPageSize: 5 }
`
    : "endpoints: []"
}
`);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.config;
}

const root = "apps/api/src";
const id = "123e4567-e89b-12d3-a456-426614174000";
const record = { id, name: "Sample" };
const origin = "https://web.example.test";

function generatedApplication(withEndpoints = true, createPath?: string) {
  const config = configuration(withEndpoints, createPath);
  const registry = new PluginRegistry();
  for (const plugin of [
    cleanArchitecturePlugin,
    honoFrameworkPlugin,
    drizzleOrmPlugin,
    betterAuthPlugin,
    rbacPbacPlugin,
  ])
    registry.register(plugin);
  const result = composeBackendPlugins(config, "api", registry);
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  const files = result.virtualFileSystem.snapshot();

  // Execute the generated entrypoint, routes, DTOs, use cases and policy unchanged.
  // Session verification and persistence are controlled at their external boundaries.
  const query = vi.fn(async () => [{ entity: record, joins: {} }]);
  const pageQuery = vi.fn(async () => ({
    items: [{ entity: record, joins: {} }],
    total: 1,
    page: 2,
    pageSize: 2,
  }));
  let dependencies: Record<string, unknown> = {};
  const authHandler = vi.fn(() => new Response("auth handler", { status: 200 }));
  const getSession = vi.fn(async ({ headers }: { headers: Headers }) => {
    const cookie = headers.get("cookie");
    const role = cookie?.match(/^verified=(editor|viewer|outsider)$/)?.[1];
    return role ? { user: { id: "test-user", role } } : null;
  });
  const modules = new Map<string, Record<string, unknown>>();
  const external: Record<string, unknown> = {
    hono,
    "hono/cors": cors,
    "@hono/zod-validator": validator,
    zod,
    [`${root}/infrastructure/auth/auth.ts`]: {
      createAuth: () => ({ api: { getSession }, handler: authHandler }),
      isTrustedAuthOrigin: (value: string) => value === origin,
    },
    [`${root}/infrastructure/adapters/create-route-dependencies.ts`]: {
      createRouteDependencies: () => dependencies,
    },
  };
  function load(path: string): Record<string, unknown> {
    if (external[path]) return external[path] as Record<string, unknown>;
    const cached = modules.get(path);
    if (cached) return cached;
    const source = files[path];
    if (!source) throw new Error(`Generated import does not exist: ${path}`);
    const module = { exports: {} };
    modules.set(path, module.exports);
    const javascript = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function("module", "exports", "require", javascript)(
      module,
      module.exports,
      (specifier: string) =>
        load(
          specifier.startsWith(".")
            ? posix.join(posix.dirname(path), specifier).replace(/\.js$/, ".ts")
            : specifier,
        ),
    );
    return module.exports;
  }
  if (withEndpoints) {
    const endpoints: Record<string, unknown> = {};
    for (const operation of ["CreateSampleItem", "ListSampleItems", "GetSampleItem"]) {
      const UseCase = load(`${root}/application/use-cases/${operation}.use-case.ts`)[
        `${operation}UseCase`
      ] as new (
        port: unknown,
      ) => unknown;
      endpoints[operation.charAt(0).toLowerCase() + operation.slice(1)] = {
        useCase: new UseCase({ execute: operation === "ListSampleItems" ? pageQuery : query }),
      };
    }
    dependencies = { endpoints };
  }
  const app = load(`${root}/index.ts`).default as hono.Hono;
  const request = (
    path: string,
    method = "GET",
    cookie?: string,
    body?: unknown,
    requestOrigin = origin,
  ) =>
    app.request(
      path,
      {
        method,
        headers: {
          origin: requestOrigin,
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) }),
      },
      { DATABASE_URL: "postgresql://unused:test@localhost/test" },
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
        props: {},
      },
    );
  return { config, files, load, request, query, pageQuery, getSession, authHandler };
}

describe("declared business routes in generated Hono applications", () => {
  it.each([false, true])(
    "does not expose implicit CRUD (declared endpoints: %s)",
    async (withEndpoints) => {
      const { files, request, getSession } = generatedApplication(withEndpoints);
      for (const collection of ["/sampleitems", "/privaterecords"]) {
        for (const path of [collection, `${collection}/${id}`]) {
          for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
            const response = await request(path, method, "verified=editor", { name: "Sample" });
            expect(response.status, `${method} ${path}`).toBe(404);
            expect(response.headers.get("content-type")).toBe("application/problem+json");
          }
        }
      }
      expect(getSession).not.toHaveBeenCalled();
      expect(files[`${root}/domain/entities/PrivateRecord.entity.ts`]).toBeDefined();
      expect(
        files[`${root}/infrastructure/adapters/PrivateRecord.drizzle.repository.ts`],
      ).toBeDefined();
      const factory = files[`${root}/infrastructure/adapters/create-route-dependencies.ts`];
      expect(factory).not.toContain("entities:");
      expect(factory).not.toContain("Repository");
      expect(factory).not.toContain("new CreateSampleItemUseCase");
      if (withEndpoints)
        expect(factory).toContain(
          "new CreateSampleItemEndpointUseCase(createSampleItemQueryAdapter)",
        );
    },
  );

  it("preserves session, role AND permission, origin, validation and success semantics", async () => {
    const { request, query, load, authHandler } = generatedApplication();
    for (const cookie of [undefined, "verified=invalid", "expired=editor"]) {
      expect((await request("/api/sample-items", "POST", cookie, { name: "Sample" })).status).toBe(
        401,
      );
    }
    for (const role of ["viewer", "outsider"]) {
      const response = await request("/api/sample-items", "POST", `verified=${role}`, {
        name: "Sample",
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        detail: "The authenticated user is not authorized for this operation",
      });
    }
    expect(
      (
        await request(
          "/api/sample-items",
          "POST",
          "verified=editor",
          { name: "Sample" },
          "https://untrusted.test",
        )
      ).status,
    ).toBe(403);
    expect((await request("/api/sample-items", "POST", "verified=editor", {})).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    const allowed = await request("/api/sample-items", "POST", "verified=editor", {
      name: "Sample",
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual([{ entity: record, joins: {} }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ body: { name: "Sample" } }) }),
    );
    const createRoutes = load(`${root}/presentation/controllers/routes.ts`)
      .createRoutes as () => hono.Hono;
    // One registration contains the auth middleware, body validator and handler.
    expect(
      createRoutes().routes.filter(
        (route) => route.method === "POST" && route.path === "/api/sample-items",
      ),
    ).toHaveLength(3);
    expect((await request("/health")).status).toBe(200);
    expect((await request("/api/auth/get-session")).status).toBe(200);
    expect(authHandler).toHaveBeenCalledTimes(1);
  });

  it("keeps public queries, path validation, pagination and response/error handling", async () => {
    const { request, pageQuery, query } = generatedApplication();
    const response = await request("/api/sample-items?name=Sample&page=2&pageSize=2");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, page: 2, pageSize: 2 });
    expect(pageQuery).toHaveBeenCalledWith({
      request: { path: {}, query: { name: "Sample", page: 2, pageSize: 2 } },
      filters: [{ entity: "SampleItem", field: "name", operator: "eq", value: "Sample" }],
      pagination: { offset: 2, limit: 2 },
    });
    expect((await request("/api/sample-items?pageSize=999")).status).toBe(400);
    expect((await request("/api/sample-items/not-a-uuid")).status).toBe(400);
    expect((await request(`/api/sample-items/${id}`)).status).toBe(200);
    query.mockRejectedValueOnce(new Error("Controlled persistence failure"));
    const error = await request(`/api/sample-items/${id}`);
    expect(error.status).toBe(500);
    expect(await error.json()).toMatchObject({
      title: "Internal Server Error",
      detail: "Controlled persistence failure",
    });
  });

  it("allows an explicitly declared former CRUD URL with its declared policy", async () => {
    const { request, query } = generatedApplication(true, "/sampleitems");
    expect(
      (await request("/sampleitems", "POST", "verified=viewer", { name: "Sample" })).status,
    ).toBe(403);
    expect(
      (await request("/sampleitems", "POST", "verified=editor", { name: "Sample" })).status,
    ).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect((await request("/sampleitems", "GET", "verified=editor")).status).toBe(404);
    expect((await request(`/sampleitems/${id}`, "DELETE", "verified=editor")).status).toBe(404);
  });

  it.each([false, true])(
    "keeps frontend consumers limited to the declared set (endpoints: %s)",
    (withEndpoints) => {
      const config = configuration(withEndpoints);
      const frontend = config.frontends[0];
      if (!frontend) throw new Error("Frontend fixture is missing");
      const api = buildFrontendApiContract(config, frontend);
      expect(api.endpoints.map(({ operationId }) => operationId)).toEqual(
        withEndpoints ? ["createSampleItem", "listSampleItems", "getSampleItem"] : [],
      );
      expect(api.entities.PrivateRecord).toBeUndefined();
      const registry = new FrontendPluginRegistry();
      for (const plugin of [
        nextjsFrontendPlugin,
        tailwindStylingPlugin,
        nativeReactUiPlugin,
        typedFetchApiPlugin,
        tanstackQueryServerStatePlugin,
        featureScreensFrontendPlugin,
        betterAuthFrontendPlugin,
        zustandClientStatePlugin,
      ])
        registry.register(plugin);
      const result = composeFrontendPlugins(config.name, frontend, registry, api);
      if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
      const files = result.virtualFileSystem.snapshot();
      const output = Object.values(files).join("\n");
      expect(output).not.toContain("/sampleitems");
      expect(output).not.toContain("/privaterecords");
      expect(output).not.toContain("updateSampleItem");
      expect(output).not.toContain("deleteSampleItem");
      const screen = Object.entries(files).find(([path]) =>
        path.endsWith("sample-item-screen.tsx"),
      )?.[1];
      if (withEndpoints) {
        expect(output).toContain("/api-explorer");
        expect(output).toContain("listSampleItems");
        expect(screen).toBeDefined();
        expect(screen).not.toContain("<TableCell>Actions</TableCell>");
        expect(screen).not.toContain(">Edit</Button>");
        expect(screen).not.toContain(">Delete</Button>");
      } else expect(screen).toBeUndefined();
    },
  );
});
