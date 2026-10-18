import { posix } from "node:path";
import * as validator from "@hono/zod-validator";
import * as hono from "hono";
import * as cors from "hono/cors";
import * as httpException from "hono/http-exception";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import { generateBackend, generateFrontend, parseNordixYaml } from "../src/index.js";
import { buildFrontendApiContract } from "../src/plugins/frontend-api-contract.js";
import { resolvedFixture } from "./fixtures.js";

function configuration(withEndpoints = true, createPath = "/api/sample-items") {
  const parsed = parseNordixYaml(`
name: declared-routes
version: 1.0.0
schemaVersion: 2
repositories: [{ name: app, path: . }]
databases:
  primary: {}
backends:
  - name: api
    repository: app
    path: apps/api
    modules:
      business:
        architecture: clean
        entities: [SampleItem, PrivateRecord]
    persistence: { database: primary }
    authentication: { methods: [email-password] }
    authorization:
      roles: [admin, editor, viewer, outsider]
      adminRole: admin
      defaultRole: viewer
      rolePermissions:
        editor: ${withEndpoints ? "[sample-items:create]" : "[]"}
        viewer: []
        outsider: ${withEndpoints ? "[sample-items:create]" : "[]"}
frontends:
  - name: web
    repository: app
    path: apps/web
    connectsTo: [api]
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

function generatedApplication(
  withEndpoints = true,
  createPath?: string,
  customize?: (config: ReturnType<typeof configuration>) => void,
) {
  const config = configuration(withEndpoints, createPath);
  customize?.(config);
  const project = resolvedFixture(config);
  const result = generateBackend(project, "api");
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
  const executions: Record<string, Record<string, unknown>> = {};
  const authHandler = vi.fn(() => new Response("auth handler", { status: 200 }));
  let currentRole: string | undefined;
  const getSession = vi.fn(async ({ headers }: { headers: Headers }) => {
    const cookie = headers.get("cookie");
    const role = cookie?.match(/^verified=(editor|viewer|outsider)$/)?.[1];
    currentRole = role;
    return role ? { user: { id: "test-user", role } } : null;
  });
  const modules = new Map<string, Record<string, unknown>>();
  const external: Record<string, unknown> = {
    [`${root}/platform/authorization/repository.ts`]: {
      createIamRepository: () => ({
        principal: async () =>
          currentRole
            ? {
                id: "test-user",
                role: currentRole,
                permissions: config.backends[0].authorization.rolePermissions[currentRole] ?? [],
              }
            : undefined,
      }),
    },
    hono,
    "hono/cors": cors,
    "hono/http-exception": httpException,
    "@hono/zod-validator": validator,
    zod,
    [`${root}/platform/auth/auth.ts`]: {
      createAuth: () => ({ api: { getSession }, handler: authHandler }),
      isTrustedAuthOrigin: (value: string) => value === origin,
    },
    [`${root}/platform/database/drizzle-database.ts`]: { createDrizzleDatabase: () => ({}) },
  };
  for (const module of Object.values(project.modules)) {
    executions[module.name] = {};
    external[
      `${root}/modules/${module.name}/infrastructure/adapters/create-route-dependencies.ts`
    ] = { createRouteDependencies: () => ({ endpoints: executions[module.name] }) };
  }
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
    for (const operation of Object.values(project.operations)) {
      const module = project.modules[operation.moduleId];
      const UseCase = load(
        `${root}/modules/${module.name}/application/use-cases/${operation.typeName}.use-case.ts`,
      )[`${operation.typeName}UseCase`] as new (
        port: unknown,
      ) => unknown;
      executions[module.name][operation.operationId] = {
        useCase: new UseCase({
          execute:
            operation.entity === "PrivateRecord"
              ? async () => [{ entity: { id: record.id, title: "Audit" }, joins: {} }]
              : operation.pagination
                ? pageQuery
                : query,
        }),
      };
    }
  }
  const app = load(`${root}/index.ts`).default as hono.Hono;
  const request = (
    path: string,
    method = "GET",
    cookie?: string,
    body?: unknown,
    requestOrigin = origin,
    rawBody = false,
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
        ...(body === undefined || method === "GET"
          ? {}
          : { body: rawBody ? String(body) : JSON.stringify(body) }),
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
  it("supports explicit credentialed CORS without generating an identity authority", async () => {
    const f = generatedApplication(true, undefined, (config) => {
      config.backends[0].authentication = undefined;
      config.backends[0].authorization = undefined;
      for (const operation of config.endpoints) {
        operation.authRequired = false;
        operation.roles = [];
        operation.permissions = [];
      }
    });
    const app = f.load(`${root}/index.ts`).default as hono.Hono;
    const env = {
      DATABASE_URL: "unused",
      CORS_ALLOWED_ORIGINS: ` https://other.example.test, ${origin} `,
    };
    const response = await app.request("/api/sample-items", { headers: { origin } }, env, {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {},
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    const preflight = await app.request(
      "/api/sample-items",
      {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      },
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    const denied = await app.request(
      "/api/sample-items",
      { headers: { origin: "https://untrusted.example.test" } },
      env,
      { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    expect(Object.keys(f.files).some((path) => path.includes("/platform/auth/"))).toBe(false);
  });
  it("decodes HTTP arrays and scalar values into the resolved flat application input", async () => {
    const { request, pageQuery } = generatedApplication(true, undefined, (config) => {
      config.entities.SampleItem.fields.count = {
        type: "number",
        format: "integer",
        required: false,
        unique: false,
      };
      const endpoint = config.endpoints.find(
        (operation) => operation.operationId === "listSampleItems",
      );
      if (!endpoint) throw new Error("Missing collection fixture");
      endpoint.queryParams.push(
        {
          name: "ids",
          field: { entity: "SampleItem", field: "id" },
          required: false,
          operator: "in",
        },
        { name: "count", field: { entity: "SampleItem", field: "count" }, required: false },
        { name: "flag", type: "boolean", required: false },
        { name: "at", type: "date", required: false },
        { name: "extra", type: "json", required: false },
      );
    });
    const search = new URLSearchParams({
      count: "2",
      flag: "false",
      at: "2024-01-01T03:00:00+03:00",
      extra: '{"active":true}',
    });
    search.append("ids", id);
    search.append("ids", id);
    expect((await request(`/api/sample-items?${search}`)).status).toBe(200);
    expect(pageQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          ids: [id, id],
          count: 2,
          flag: false,
          at: new Date("2024-01-01T00:00:00Z"),
          extra: { active: true },
        }),
      }),
    );
    expect((await request(`/api/sample-items?ids=${id}`)).status).toBe(200);
    expect(pageQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ ids: [id] }) }),
    );
    for (const query of [
      "count=1&count=2",
      "count=",
      "count=1.5",
      "flag=1",
      "at=2024-01-01",
      "extra=%7B",
      "unknown=1",
    ])
      expect((await request(`/api/sample-items?${query}`)).status, query).toBe(400);
    expect(pageQuery).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed JSON and undeclared query names before invoking an operation", async () => {
    const { request, query } = generatedApplication();
    const malformed = await request(
      "/api/sample-items",
      "POST",
      "verified=editor",
      "{",
      origin,
      true,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ detail: "Malformed request data" });
    expect((await request(`/api/sample-items/${id}?unknown=1`)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("serializes application Date values as UTC JSON strings and absent nullable values as null", async () => {
    const { request, query, config } = generatedApplication(true, undefined, (config) => {
      config.entities.SampleItem.fields.publishedAt = {
        type: "date",
        required: false,
        unique: false,
      };
      config.entities.SampleItem.fields.metadata = { type: "json", required: false, unique: false };
    });
    const publishedAt = new Date("2024-06-15T12:00:00+03:00");
    query.mockResolvedValueOnce([{ entity: { ...record, publishedAt }, joins: {} }]);
    const response = await request(`/api/sample-items/${id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { entity: { ...record, publishedAt: "2024-06-15T09:00:00.000Z", metadata: null }, joins: {} },
    ]);
    const api = buildFrontendApiContract(resolvedFixture(config), "web");
    const fields = api.endpoints.find((operation) => operation.operationId === "getSampleItem")
      ?.response.entity;
    expect(fields?.publishedAt).toMatchObject({
      nullable: true,
      value: { transportType: "string", serialization: "utc-iso-instant" },
    });
    expect(fields?.metadata).toMatchObject({ nullable: true, type: "json" });
    const created = await request("/api/sample-items", "POST", "verified=editor", {
      name: "Sample",
      publishedAt: "2024-06-15T12:00:00+03:00",
    });
    expect(created.status).toBe(200);
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ request: { name: "Sample", publishedAt } }),
    );
    expect(
      (
        await request("/api/sample-items", "POST", "verified=editor", {
          name: "Sample",
          publishedAt: "2024-06-15",
        })
      ).status,
    ).toBe(400);
  });
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
      expect(
        files[`${root}/modules/business/domain/entities/PrivateRecord.entity.ts`],
      ).toBeDefined();
      expect(
        files[
          `${root}/modules/business/infrastructure/adapters/PrivateRecord.drizzle.repository.ts`
        ],
      ).toBeUndefined();
      const factory =
        files[`${root}/modules/business/infrastructure/adapters/create-route-dependencies.ts`];
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
    const { request, query, load, authHandler, getSession } = generatedApplication();
    for (const cookie of [undefined, "verified=invalid", "expired=editor"]) {
      expect((await request("/api/sample-items", "POST", cookie, { name: "Sample" })).status).toBe(
        401,
      );
    }
    for (const role of ["viewer"]) {
      const response = await request("/api/sample-items", "POST", `verified=${role}`, {
        name: "Sample",
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        detail: "Required roles or permissions are missing.",
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
    getSession.mockClear();
    const allowed = await request("/api/sample-items", "POST", "verified=editor", {
      name: "Sample",
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual([{ entity: record, joins: {} }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ request: { name: "Sample" } }));
    const createRoutes = load(`${root}/platform/http/controllers/routes.ts`)
      .createRoutes as () => hono.Hono;
    // One registration contains auth, the strict empty query contract, body validation and handler.
    expect(
      createRoutes().routes.filter(
        (route) => route.method === "POST" && route.path === "/api/sample-items",
      ),
    ).toHaveLength(4);
    expect((await request("/health")).status).toBe(200);
    expect((await request("/api/auth/get-session")).status).toBe(200);
    expect(authHandler).toHaveBeenCalledTimes(1);
  });

  it("checks every permission, accepts either allowed role and ignores client identity claims", async () => {
    const f = generatedApplication(true, undefined, (config) => {
      config.backends[0].authorization.rolePermissions.editor.push("sample-items:approve");
      config.endpoints[0].permissions.push("sample-items:approve");
      config.backends[0].authorization.rolePermissions.outsider.push("sample-items:approve");
    });
    expect(
      (
        await f.request("/api/sample-items", "POST", "verified=viewer", {
          name: "Test",
          role: "editor",
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.request("/api/sample-items", "POST", "verified=outsider", { name: "Test" })).status,
    ).toBe(200);
    expect((await f.request("/api/sample-items", "POST", undefined, {})).status).toBe(401);
    const partial = generatedApplication(true, undefined, (config) => {
      config.endpoints[0].permissions.push("sample-items:approve");
      config.backends[0].authorization.rolePermissions.outsider.push("sample-items:approve");
    });
    expect(
      (await partial.request("/api/sample-items", "POST", "verified=editor", { name: "Test" }))
        .status,
    ).toBe(403);
  });

  it("keeps public queries, path validation, pagination and response/error handling", async () => {
    const { request, pageQuery, query } = generatedApplication();
    const response = await request("/api/sample-items?name=Sample&page=2&pageSize=2");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, page: 2, pageSize: 2 });
    expect(pageQuery).toHaveBeenCalledWith({
      request: { name: "Sample", page: 2, pageSize: 2 },
      filters: [{ entity: "SampleItem", field: "name", operator: "eq", value: "Sample" }],
      pagination: { offset: 2, limit: 2 },
    });
    expect((await request("/api/sample-items?pageSize=999")).status).toBe(400);
    expect((await request("/api/sample-items/not-a-uuid")).status).toBe(400);
    expect((await request(`/api/sample-items/${id}`)).status).toBe(200);
    query.mockRejectedValueOnce(new Error("Controlled persistence failure"));
    const error = await request(`/api/sample-items/${id}`);
    expect(error.status).toBe(500);
    const problem = await error.json();
    expect(problem).toMatchObject({
      title: "Internal Server Error",
      detail: "An unexpected error occurred",
    });
    expect(JSON.stringify(problem)).not.toContain("Controlled persistence failure");
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
      const declaration = config.frontends[0];
      const project = resolvedFixture(config);
      const frontend = declaration ? project.frontends[declaration.name] : undefined;
      if (!frontend) throw new Error("Frontend fixture is missing");
      const api = buildFrontendApiContract(project, frontend.name);
      expect(api.endpoints.map(({ operationId }) => operationId)).toEqual(
        withEndpoints ? ["listSampleItems", "createSampleItem", "getSampleItem"] : [],
      );
      expect(api.entities.PrivateRecord).toBeUndefined();
      const result = generateFrontend(resolvedFixture(config), "web");
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

describe("multi-module HTTP assembly", () => {
  it("mounts declared operations from two Clean modules in the same Hono application", async () => {
    const fixture = generatedApplication(true, "/api/sample-items", (config) => {
      config.backends[0].modules.business.entities = ["SampleItem"];
      config.backends[0].modules.audit = {
        architecture: "clean",
        entities: ["PrivateRecord"],
        imports: {},
        exports: [],
      };
      config.endpoints.push({
        backend: "api",
        entity: "PrivateRecord",
        operationId: "listAudit",
        method: "GET",
        path: "/audit-records",
        authRequired: false,
      });
    });
    expect((await fixture.request("/api/sample-items")).status).toBe(200);
    const audit = await fixture.request("/audit-records");
    expect(audit.status).toBe(200);
    expect(await audit.json()).toMatchObject([{ entity: { title: "Audit" } }]);
    expect((await fixture.request("/private-records")).status).toBe(404);
  });
});
