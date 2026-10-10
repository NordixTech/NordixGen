import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import {
  cleanArchitecturePlugin,
  resolveCleanArchitectureLayout,
} from "../src/plugins/architecture/clean.js";
import { composeBackendPlugins } from "../src/plugins/composer.js";
import type {
  ArchitectureLayout,
  FrameworkContext,
  GeneratorPlugin,
  PluginContributionContext,
} from "../src/plugins/contracts.js";
import { honoFrameworkPlugin } from "../src/plugins/frameworks/hono.js";
import {
  generateDrizzleAdapterFiles,
  generateDrizzleMigrationFiles,
  generateDrizzleSchemaFiles,
  generateDrizzleSeedFiles,
} from "../src/plugins/orms/drizzle-files.js";
import { drizzleOrmPlugin } from "../src/plugins/orms/drizzle.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { createValidConfig } from "./fixtures.js";

function createRegistry(framework: GeneratorPlugin = honoFrameworkPlugin) {
  const registry = new PluginRegistry();
  registry.register(framework);
  registry.register(cleanArchitecturePlugin);
  registry.register(drizzleOrmPlugin);
  return registry;
}

function createDrizzleContext(
  persistence: PluginContributionContext["persistence"] | null = createValidPersistenceContext(),
): PluginContributionContext {
  const selection = { pluginId: "hono", configuration: { applicationRoot: "apps/api-core" } };
  const framework = honoFrameworkPlugin.createFrameworkContext?.(selection);
  if (!framework) throw new Error("Hono framework context is unavailable.");
  const architecture = cleanArchitecturePlugin.resolveArchitectureLayout?.(framework, {
    pluginId: "clean",
  });
  if (!architecture) throw new Error("Clean architecture layout is unavailable.");
  return {
    selection: { pluginId: "drizzle" },
    framework,
    architecture,
    availableCapabilities: new Set(),
    ...(persistence ? { persistence } : {}),
  };
}

function createValidPersistenceContext(): NonNullable<PluginContributionContext["persistence"]> {
  return {
    database: { name: "commerce-db", engine: "postgres", provider: "neon" },
    directories: {
      infrastructure: "apps/api-core/src/infrastructure",
      adapter: "apps/api-core/src/infrastructure/adapters",
    },
    connectionStringEnvironmentVariable: "DATABASE_URL",
  };
}

describe("Drizzle ORM plugin", () => {
  it("declares framework-agnostic language, runtime, database, and driver capabilities", () => {
    expect(drizzleOrmPlugin.descriptor).toMatchObject({
      id: "drizzle",
      role: "orm",
      provides: ["orm:drizzle", "driver:neon-http"],
      requires: [
        { capability: "language:typescript" },
        { capability: "runtime:cloudflare-workers" },
        { capability: "database:postgres" },
        { capability: "provider:neon" },
      ],
    });
  });

  it.each([
    ["missing persistence context", null],
    [
      "non-PostgreSQL database",
      {
        ...createValidPersistenceContext(),
        database: { name: "commerce-db", engine: "mysql", provider: "neon" },
      },
    ],
    [
      "non-Neon provider",
      {
        ...createValidPersistenceContext(),
        database: { name: "commerce-db", engine: "postgres", provider: "local" },
      },
    ],
    [
      "unexpected connection string environment variable",
      {
        ...createValidPersistenceContext(),
        connectionStringEnvironmentVariable: "DATABASE_CONNECTION",
      },
    ],
  ])("rejects %s when called without validated composition", (_label, persistence) => {
    const context = createDrizzleContext(persistence);
    expect(() => drizzleOrmPlugin.contribute(context)).toThrow();
  });

  it("generates Drizzle Kit configuration from the selected backend persistence context", () => {
    const config = NordixConfigSchema.parse(createValidConfig());
    const result = composeBackendPlugins(config, "core-api", createRegistry());

    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    expect(Object.keys(files)).toContain("apps/api-core/drizzle.config.ts");
    expect(files["apps/api-core/drizzle.config.ts"]).toContain(
      'schema: "./src/infrastructure/database/schema/index.ts"',
    );
    expect(files["apps/api-core/drizzle.config.ts"]).toContain('dialect: "postgresql"');
    expect(files["apps/api-core/drizzle.config.ts"]).toContain("process.env.DATABASE_URL");
    expect(files["apps/api-core/src/infrastructure/database/schema/index.ts"]).toContain(
      "export const OrderTable = pgTable(",
    );
    expect(files["apps/api-core/src/infrastructure/database/schema/index.ts"]).toContain(
      "export const UserTable = pgTable(",
    );
    expect(files["apps/api-core/src/infrastructure/database/schema/index.ts"]).toContain(
      "export const OrderStatusPgEnum = pgEnum(",
    );
    expect(
      files["apps/api-core/src/infrastructure/adapters/Order.drizzle.repository.ts"],
    ).toContain("class DrizzleOrderRepository implements OrderRepository");
    expect(files["apps/api-core/src/infrastructure/adapters/User.drizzle.repository.ts"]).toContain(
      "class DrizzleUserRepository implements UserRepository",
    );
    expect(files["apps/api-core/src/infrastructure/adapters/drizzle-database.ts"]).toContain(
      "createDrizzleDatabase",
    );
  });

  it("resolves generated schema paths from the selected architecture layout", () => {
    const modularArchitecture: GeneratorPlugin = {
      descriptor: {
        id: "modular",
        version: "1.0.0",
        role: "architecture",
        provides: ["architecture:modular"],
      },
      resolveArchitectureLayout(framework): ArchitectureLayout {
        return {
          pluginId: "modular",
          codeRoot: framework.codeRoot,
          directories: {
            domainEntity: "domain",
            useCase: "application/use-cases",
            inboundPort: "application/ports/inbound",
            outboundPort: "application/ports/outbound",
            adapter: "persistence/adapters",
            controller: "http/controllers",
            infrastructure: "persistence",
          },
          dependencyRules: [],
        };
      },
      contribute: () => [],
    };
    const registry = new PluginRegistry();
    registry.register(honoFrameworkPlugin);
    registry.register(modularArchitecture);
    registry.register(drizzleOrmPlugin);
    const config = createValidConfig();
    const backend = config.backends[0];
    if (!backend) throw new Error("Fixture backend is missing.");
    backend.architecture = "modular";

    const result = composeBackendPlugins(NordixConfigSchema.parse(config), "core-api", registry);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.virtualFileSystem.snapshot()["apps/api-core/drizzle.config.ts"]).toContain(
      'schema: "./src/persistence/database/schema/index.ts"',
    );
  });

  it.each([
    ["database engine", { engine: "mysql", provider: "neon" }],
    ["database provider", { engine: "postgres", provider: "local" }],
  ])("rejects an unsupported %s before generating files", (_label, database) => {
    const config = createValidConfig();
    config.databases["commerce-db"] = database;
    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CAPABILITY_MISSING", path: "plugins.drizzle" }),
    );
  });

  it("rejects a TypeScript framework on an unsupported runtime before contribution", () => {
    const frameworkContext: FrameworkContext = {
      pluginId: "node-framework",
      applicationRoot: "apps/api-core",
      codeRoot: "apps/api-core/src",
      language: "typescript",
      runtime: "node",
      moduleSystem: "esm",
      scaffold: { executable: "pnpm", argumentsBeforeTarget: [], argumentsAfterTarget: [] },
      entryPoints: { app: "apps/api-core/src/index.ts" },
      conventions: { importExtension: ".js" },
    };
    const nodeFrameworkPlugin: GeneratorPlugin = {
      descriptor: {
        id: "node-framework",
        version: "1.0.0",
        role: "framework",
        provides: ["language:typescript", "runtime:node"],
      },
      createFrameworkContext: () => frameworkContext,
      contribute: () => [],
    };
    const config = createValidConfig();
    const backend = config.backends[0];
    if (!backend) throw new Error("Fixture backend is missing.");
    backend.framework = "node-framework";
    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(nodeFrameworkPlugin),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CAPABILITY_MISSING", path: "plugins.drizzle" }),
    );
  });

  it("covers generated schemas, repository adapters, and query adapters", () => {
    const config = createValidConfig();
    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    const schema = files["apps/api-core/src/infrastructure/database/schema/index.ts"];
    expect(schema).toBeDefined();
    expect(schema).toContain("export const OrderTable = pgTable(");
    expect(schema).toContain("export const OrderRelations = relations(");
    expect(schema).toContain("export const OrderStatusPgEnum = pgEnum(");

    const orderAdapter =
      files["apps/api-core/src/infrastructure/adapters/Order.drizzle.repository.ts"];
    expect(orderAdapter).toContain("class DrizzleOrderRepository implements OrderRepository");
    expect(orderAdapter).toContain("isDeleted");
    expect(orderAdapter).toContain("findPage");
    expect(orderAdapter).toContain("findById");
    expect(orderAdapter).toContain("findMany");
    expect(orderAdapter).toContain("save");
    expect(orderAdapter).toContain("delete");

    const userAdapter =
      files["apps/api-core/src/infrastructure/adapters/User.drizzle.repository.ts"];
    expect(userAdapter).toContain("class DrizzleUserRepository implements UserRepository");
    expect(userAdapter).toContain("deletedAt");

    const orderItemAdapter =
      files["apps/api-core/src/infrastructure/adapters/OrderItem.drizzle.repository.ts"];
    expect(orderItemAdapter).toContain(
      "class DrizzleOrderItemRepository implements OrderItemRepository",
    );
    expect(orderItemAdapter).not.toContain("deletedAt");
    expect(orderItemAdapter).not.toContain("isDeleted");

    const queryAdapter =
      files["apps/api-core/src/infrastructure/adapters/getOrderSummary.drizzle.query.adapter.ts"];
    expect(queryAdapter).toBeDefined();
    expect(queryAdapter).toContain(
      "class DrizzlegetOrderSummaryQueryAdapter implements getOrderSummaryQueryPort",
    );
    expect(queryAdapter).toContain("execute(input: QueryExecution): Promise<Response>");
  });

  it("covers custom unpaginated query adapter and diverse field types", () => {
    const config = createValidConfig();
    config.entities.User.fields = {
      ...config.entities.User.fields,
      bio: { type: "string", maxLength: 200, required: false },
      age: { type: "number", format: "integer", default: 18 },
      rating: { type: "number", format: "decimal", precision: 5, scale: 2 },
      metadata: { type: "json", required: false },
      token: { type: "uuid", required: true },
      isActive: { type: "boolean", default: true },
      joinedAt: { type: "date", default: { kind: "now" } },
      verifiedAt: { type: "date", default: "2026-01-01T00:00:00Z" },
    };
    config.endpoints.push({
      path: "/api/orders/details",
      method: "GET",
      operationId: "getOrderDetails",
      backend: "core-api",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      joins: [{ entity: "User", type: "inner", fields: ["id", "email"] }],
    });

    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    const schema = files["apps/api-core/src/infrastructure/database/schema/index.ts"];
    expect(schema).toContain('varchar("bio", { length: 200 })');
    expect(schema).toContain('integer("age").notNull().default(18)');
    expect(schema).toContain('numeric("rating", { precision: 5, scale: 2 }).notNull()');
    expect(schema).toContain('jsonb("metadata")');
    expect(schema).toContain('uuid("token").notNull()');
    expect(schema).toContain('boolean("is_active").notNull().default(true)');
    expect(schema).toContain(".defaultNow()");
    expect(schema).toContain("::timestamptz");

    const detailsAdapter =
      files["apps/api-core/src/infrastructure/adapters/getOrderDetails.drizzle.query.adapter.ts"];
    expect(detailsAdapter).toBeDefined();
    expect(detailsAdapter).toContain(
      "class DrizzlegetOrderDetailsQueryAdapter implements getOrderDetailsQueryPort",
    );
  });

  it("handles entities without soft delete and timestamp soft delete query adapters", () => {
    const userSummaryConfig = createValidConfig();
    userSummaryConfig.entities.User.softDelete = "timestamp";
    userSummaryConfig.endpoints.push({
      path: "/api/user/summary",
      method: "GET",
      operationId: "getUserSummary",
      backend: "core-api",
      entity: "User",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      joins: [{ entity: "Order", type: "left", fields: ["total"] }],
    });
    const userSummaryResult = composeBackendPlugins(
      NordixConfigSchema.parse(userSummaryConfig),
      "core-api",
      createRegistry(),
    );
    expect(userSummaryResult.success).toBe(true);
    if (!userSummaryResult.success) return;
    const userSummaryFiles = userSummaryResult.virtualFileSystem.snapshot();
    expect(
      userSummaryFiles[
        "apps/api-core/src/infrastructure/adapters/getUserSummary.drizzle.query.adapter.ts"
      ],
    ).toContain("deletedAt");

    const falseDeleteConfig = createValidConfig();
    falseDeleteConfig.entities.Order.softDelete = false;
    falseDeleteConfig.endpoints = [
      {
        path: "/api/orders/auto",
        method: "GET",
        backend: "core-api",
        entity: "Order",
        authRequired: false,
        roles: [],
        permissions: [],
        queryParams: [],
        pathParams: [],
        joins: [{ entity: "User", type: "left", fields: ["id"] }],
      },
    ];
    const falseDeleteResult = composeBackendPlugins(
      NordixConfigSchema.parse(falseDeleteConfig),
      "core-api",
      createRegistry(),
    );
    expect(falseDeleteResult.success).toBe(true);
    if (!falseDeleteResult.success) return;
    const falseDeleteFiles = falseDeleteResult.virtualFileSystem.snapshot();
    expect(
      falseDeleteFiles[
        "apps/api-core/src/infrastructure/adapters/getapiordersauto.drizzle.query.adapter.ts"
      ],
    ).toBeDefined();
  });

  it("covers schemas without relations, one-to-one relations, and findPage filtering", () => {
    const config = createValidConfig();
    config.entities.User.fields.weight = { type: "number", precision: 6 };
    config.entities.User.fields.balance = { type: "number", format: "decimal", scale: 4 };
    config.entities.User.relations.profile = {
      type: "one-to-one",
      target: "User",
    };
    config.entities.Order.relations.author = {
      type: "many-to-one",
      target: "User",
    };
    config.entities.OrderItem.softDelete = false;
    config.endpoints.push({
      path: "/api/order-items/page",
      method: "GET",
      operationId: "getOrderItemPage",
      backend: "core-api",
      entity: "OrderItem",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      pagination: { strategy: "offset", defaultPageSize: 10, maxPageSize: 50 },
      joins: [],
    });
    const resultWithOne = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(),
    );
    expect(resultWithOne.success).toBe(true);
    if (!resultWithOne.success) return;
    const pageFiles = resultWithOne.virtualFileSystem.snapshot();
    expect(
      pageFiles["apps/api-core/src/infrastructure/adapters/OrderItem.drizzle.repository.ts"],
    ).toContain("findPage");

    config.enums = {};
    config.entities.User.fields.role = { type: "string" };
    config.entities.Order.fields.status = { type: "string" };
    config.entities.User.relations = {};
    config.entities.Order.relations = {};
    config.entities.OrderItem.relations = {};
    config.endpoints = [];
    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const files = result.virtualFileSystem.snapshot();
    const schema = files["apps/api-core/src/infrastructure/database/schema/index.ts"];
    expect(schema).toBeDefined();
    expect(schema).not.toContain("relations(");
  });

  it("returns empty arrays when domain model is undefined", () => {
    const context = createDrizzleContext();
    (context as Record<string, unknown>).domainModel = undefined;
    const persistence = createValidPersistenceContext();
    expect(generateDrizzleSchemaFiles(context, persistence)).toEqual([]);
    expect(generateDrizzleAdapterFiles(context, persistence)).toEqual([]);
    expect(generateDrizzleMigrationFiles(context, persistence)).toEqual([]);
    expect(generateDrizzleSeedFiles(context, persistence)).toEqual([]);
  });

  it("skips query adapter generation when endpoint entity is not in domain model", () => {
    const context = createDrizzleContext();
    context.domainModel = {
      enums: {},
      entities: {},
      endpoints: [
        {
          entity: "MissingEntity",
          path: "/missing",
          method: "GET",
          operationId: "getMissing",
          description: "Missing",
          params: [],
          query: [],
          headers: [],
          body: null,
          responses: {},
          joins: [{ entity: "Other", fields: ["name"] }],
        },
      ],
    };
    const persistence = createValidPersistenceContext();
    const files = generateDrizzleAdapterFiles(context, persistence);
    expect(
      files.find((f) => f.path.includes("getMissing.drizzle.query.adapter.ts")),
    ).toBeUndefined();
  });

  it("generates migration runner, README, and deterministic topological seeders", () => {
    const config = createValidConfig();
    config.entities.User.fields.name = { type: "string" };
    config.entities.User.fields.shortCode = { type: "string", maxLength: 10 };
    config.entities.User.fields.bio = { type: "string", maxLength: 200 };
    config.entities.User.fields.age = { type: "number", format: "integer" };
    config.entities.User.fields.score = { type: "number", format: "float" };
    config.entities.User.fields.isActive = { type: "boolean" };
    config.entities.User.fields.birthDate = { type: "date" };
    config.entities.User.fields.externalId = { type: "uuid" };
    config.entities.User.fields.metadata = { type: "json" };
    config.entities.User.fields.optionalNotes = { type: "string", required: false };

    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    const migrateFile = files["apps/api-core/src/infrastructure/database/migrate.ts"];
    const readmeFile = files["apps/api-core/src/infrastructure/database/README.md"];
    const seedFile = files["apps/api-core/src/infrastructure/database/seed.ts"];

    expect(migrateFile).toBeDefined();
    expect(migrateFile).toContain("runMigrations");
    expect(migrateFile).toContain("drizzle-orm/neon-http/migrator");

    expect(readmeFile).toBeDefined();
    expect(readmeFile).toContain("# Database Management & Migrations");
    expect(readmeFile).toContain("pnpm drizzle-kit generate");

    expect(seedFile).toBeDefined();
    expect(seedFile).toContain("@faker-js/faker");
    expect(seedFile).toContain("faker.seed(seedValue);");
    expect(seedFile).toContain("faker.internet.email()");
    expect(seedFile).toContain("faker.person.fullName()");
    expect(seedFile).toContain("faker.string.alphanumeric(10)");
    expect(seedFile).toContain("faker.number.int({ min: 1, max: 1000 })");
    expect(seedFile).toContain("faker.datatype.boolean()");
    expect(seedFile).toContain("faker.string.uuid()");
    expect(seedFile).toContain("faker.helpers.arrayElement");

    // Verify topological order in seeder: User before Order before OrderItem
    const userIndex = seedFile.indexOf("// Seed User");
    const orderIndex = seedFile.indexOf("// Seed Order");
    const orderItemIndex = seedFile.indexOf("// Seed OrderItem");
    expect(userIndex).toBeGreaterThan(-1);
    expect(orderIndex).toBeGreaterThan(userIndex);
    expect(orderItemIndex).toBeGreaterThan(orderIndex);
  });

  it("handles empty entities and fallback order in seed generation", () => {
    const context = createDrizzleContext();
    context.domainModel = {
      enums: {},
      entities: {},
      endpoints: [],
    };
    const persistence = createValidPersistenceContext();
    const files = generateDrizzleSeedFiles(context, persistence);
    expect(files).toHaveLength(1);
    expect(files[0]?.content).toContain("export async function seedDatabase");
  });
});
