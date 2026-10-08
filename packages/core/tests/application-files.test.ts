import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { generateApplicationFiles } from "../src/plugins/architecture/application-files.js";
import { cleanArchitecturePlugin } from "../src/plugins/architecture/clean.js";
import { resolveCleanArchitectureLayout } from "../src/plugins/architecture/clean.js";
import { composeBackendPlugins } from "../src/plugins/composer.js";
import type { DomainModelContext, PluginContributionContext } from "../src/plugins/contracts.js";
import { honoFrameworkPlugin } from "../src/plugins/frameworks/hono.js";
import { drizzleOrmPlugin } from "../src/plugins/orms/drizzle.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { createValidConfig } from "./fixtures.js";

function composeFixture() {
  const config = createValidConfig();
  config.entities.User.fields.level = { type: "number", format: "integer" };
  const summaryEndpoint = config.endpoints[0];
  if (summaryEndpoint) summaryEndpoint.permissions = ["orders:read"];
  config.endpoints.push({
    backend: "core-api",
    path: "/",
    method: "GET",
    entity: "User",
    authRequired: false,
    roles: [],
    permissions: [],
    queryParams: [],
    pathParams: [],
    joins: [],
  });
  config.endpoints.push({
    backend: "core-api",
    path: "/api/orders/:orderId/notes",
    method: "POST",
    entity: "Order",
    authRequired: true,
    roles: ["admin"],
    permissions: ["orders:update"],
    queryParams: [
      { name: "revision", type: "number", required: true },
      { name: "includeArchived", type: "boolean", required: false },
      { name: "status", type: "enum", enumName: "OrderStatus", required: true },
    ],
    pathParams: [{ name: "orderId", type: "uuid", required: true }],
    requestBody: { note: { type: "string", minLength: 1, maxLength: 50, required: true } },
    joins: [],
  });
  config.endpoints.push({
    backend: "core-api",
    path: "/api/orders/:orderId/notes",
    method: "PATCH",
    entity: "Order",
    authRequired: true,
    roles: [],
    permissions: [],
    queryParams: [],
    pathParams: [{ name: "orderId", type: "uuid", required: true }],
    joins: [],
  });
  const registry = new PluginRegistry();
  registry.register(honoFrameworkPlugin);
  registry.register(cleanArchitecturePlugin);
  registry.register(drizzleOrmPlugin);
  return composeBackendPlugins(NordixConfigSchema.parse(config), "core-api", registry);
}

describe("Clean Architecture application artifacts", () => {
  it("generates validated CRUD use cases, DTOs, and pagination ports", () => {
    const result = composeFixture();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const files = result.virtualFileSystem.snapshot();
    const root = "apps/api-core/src/application/use-cases";
    const create = files[`${root}/User/create-user.use-case.ts`];
    const list = files[`${root}/User/list-user.use-case.ts`];
    const update = files[`${root}/User/update-user.use-case.ts`];
    const dto = files[`${root}/dtos/User.dto.ts`];
    const repository = files["apps/api-core/src/application/ports/outbound/User.repository.ts"];

    expect(create).toContain("CreateUserSchema.parse(input)");
    expect(create).toContain("this.repository.create");
    expect(list).toContain("(page - 1) * pageSize");
    expect(list).toContain("this.repository.findPage");
    expect(update).toContain("UpdateUserRequestSchema.parse(input)");
    expect(dto).toContain('import { z } from "zod";');
    expect(dto).toContain("CreateUserSchema = z.object");
    expect(dto).toContain("UserResponseSchema = z.object");
    expect(dto).toContain("PaginationInputSchema.extend");
    expect(repository).toContain("create(input: CreateUserInput): Promise<User>");
    expect(repository).toContain("findPage(filter: Partial<User>, offset: number, limit: number)");
    expect(result.runtimeDependencies).toMatchObject({ zod: "^3.24.2" });
    expect(create).not.toMatch(/hono|drizzle/i);
    expect(list).not.toMatch(/hono|drizzle/i);
  });

  it("generates joined endpoint DTOs, query ports, validation, and authorization metadata", () => {
    const result = composeFixture();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const files = result.virtualFileSystem.snapshot();
    const root = "apps/api-core/src/application/use-cases";
    const endpoint = "GetApiOrdersSummary";
    const dto = files[`${root}/dtos/endpoints/${endpoint}.dto.ts`];
    const useCase = files[`${root}/${endpoint}.use-case.ts`];
    const port = files[`apps/api-core/src/application/ports/outbound/${endpoint}.query.port.ts`];

    expect(dto).toContain("QueryParamsSchema = z.object");
    expect(dto).toContain('"status": z.enum(["PENDING", "PAID"])');
    expect(dto).toContain('"User": z.object');
    expect(dto).toContain('"email": UserResponseSchema.shape["email"]');
    expect(dto).toContain('"OrderItem": z.array');
    expect(dto).toContain('"authRequired": true');
    expect(dto).toContain('"roles": [\n    "admin"');
    expect(dto).toContain('"permissions": [\n    "orders:read"');
    expect(useCase).toContain("InputSchema.parse(rawInput)");
    expect(useCase).toContain("ResponseSchema.parse(await this.query.execute(input))");
    expect(port).toContain("export interface GetApiOrdersSummaryQueryPort");
    expect(useCase).not.toMatch(/hono|drizzle/i);
    expect(port).not.toMatch(/hono|drizzle/i);

    const mutationDto = files[`${root}/dtos/endpoints/PostApiOrdersOrderIdNotes.dto.ts`];
    expect(mutationDto).toContain('"orderId": z.string().uuid()');
    expect(mutationDto).toContain('"revision": z.number()');
    expect(mutationDto).toContain('"includeArchived": z.boolean().optional()');
    expect(mutationDto).toContain('"status": z.enum(["PENDING", "PAID"])');
    expect(mutationDto).toContain('"note": z.string()');
    expect(mutationDto).toContain("RequestBodySchema");
    expect(files[`${root}/dtos/endpoints/GetEndpoint.dto.ts`]).toBeDefined();
  });

  it("typechecks generated application DTOs and use cases against domain contracts", async () => {
    const result = composeFixture();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const root = await mkdtemp(join(packageRoot, ".nordixgen-application-types-"));
    try {
      await writeFile(join(root, "package.json"), '{"type":"module"}\n', "utf8");
      const sourcePaths = Object.keys(result.virtualFileSystem.snapshot()).filter(
        (path) =>
          path.endsWith(".ts") &&
          (path.includes("/application/") || path.includes("/domain/entities/")),
      );
      for (const sourcePath of sourcePaths) {
        const relativePath = sourcePath.split("/").slice(3).join("/");
        const destination = join(root, relativePath);
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, result.virtualFileSystem.snapshot()[sourcePath] ?? "", "utf8");
      }
      const program = ts.createProgram(
        sourcePaths.map((sourcePath) => join(root, sourcePath.split("/").slice(3).join("/"))),
        {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
        },
      );
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(
        diagnostics.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        ),
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "missing entity",
      new Proxy(
        {},
        {
          ownKeys: () => ["User"],
          get: () => undefined,
          getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
        },
      ) as DomainModelContext["entities"],
      [],
      'Domain model is missing entity "User".',
    ],
    [
      "missing endpoint entity",
      {},
      [endpointDefinition({ entity: "Missing" })],
      'Domain model is missing endpoint entity "Missing".',
    ],
    [
      "missing join entity",
      { User: domainEntity("User") },
      [endpointDefinition({ joins: [{ entity: "Missing", type: "inner", fields: [] }] })],
      'Domain model is missing join entity "Missing".',
    ],
    [
      "missing join field",
      { User: domainEntity("User"), Order: domainEntity("Order") },
      [endpointDefinition({ joins: [{ entity: "Order", type: "inner", fields: ["absent"] }] })],
      'Domain model is missing field "Order.absent".',
    ],
    [
      "missing field enum",
      {
        User: {
          ...domainEntity("User"),
          fields: { role: { type: "enum", enumName: "Missing", required: true, unique: false } },
        },
      },
      [],
      'Domain model is missing enum "Missing".',
    ],
    [
      "missing endpoint enum name",
      { User: domainEntity("User") },
      [
        endpointDefinition({
          queryParams: [{ name: "status", type: "enum", required: true } as never],
        }),
      ],
      'Domain model is missing enum "undefined".',
    ],
    [
      "unregistered endpoint enum",
      { User: domainEntity("User") },
      [
        endpointDefinition({
          queryParams: [
            { name: "status", type: "enum", enumName: "Missing", required: true } as never,
          ],
        }),
      ],
      'Domain model is missing enum "Missing".',
    ],
  ])("rejects an invalid %s reference", (_label, entities, endpoints, message) => {
    expect(() => generateApplicationFiles(applicationContext(entities, endpoints))).toThrow(
      message,
    );
  });
});

function domainEntity(name: string): DomainModelContext["entities"][string] {
  return {
    name,
    backend: "api",
    fields: {},
    relations: {},
    timestamps: { createdAt: false, updatedAt: false },
    softDelete: false,
  };
}

function endpointDefinition(
  overrides: Partial<DomainModelContext["endpoints"][number]> = {},
): DomainModelContext["endpoints"][number] {
  return {
    backend: "api",
    path: "/test",
    method: "GET",
    entity: "User",
    authRequired: false,
    roles: [],
    permissions: [],
    queryParams: [],
    pathParams: [],
    joins: [],
    ...overrides,
  };
}

function applicationContext(
  entities: DomainModelContext["entities"],
  endpoints: DomainModelContext["endpoints"],
): PluginContributionContext {
  const selection = { pluginId: "hono", configuration: { applicationRoot: "apps/api-core" } };
  const framework = honoFrameworkPlugin.createFrameworkContext?.(selection);
  if (!framework) throw new Error("Hono framework context is unavailable.");
  return {
    selection: { pluginId: "clean" },
    framework,
    architecture: resolveCleanArchitectureLayout(framework),
    availableCapabilities: new Set(),
    domainModel: { enums: {}, entities, endpoints },
  };
}
