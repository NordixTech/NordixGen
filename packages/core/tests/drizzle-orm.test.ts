import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import {
  cleanArchitecturePlugin,
  resolveCleanArchitectureLayout,
} from "../src/plugins/architecture/clean.js";
import { betterAuthPlugin } from "../src/plugins/authentication/better-auth.js";
import { rbacPbacPlugin } from "../src/plugins/authorization/rbac-pbac.js";
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
import { backendView } from "../src/project/views.js";
import { resolvedFixture } from "./fixtures.js";
import { createSecuredConfig, createValidConfig } from "./fixtures.js";

function createRegistry(framework: GeneratorPlugin = honoFrameworkPlugin) {
  const registry = new PluginRegistry();
  registry.register(framework);
  registry.register(cleanArchitecturePlugin);
  registry.register(drizzleOrmPlugin);
  registry.register(betterAuthPlugin);
  registry.register(rbacPbacPlugin);
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
    const result = composeBackendPlugins(resolvedFixture(config), "core-api", createRegistry());

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
      "export const CustomerTable = pgTable(",
    );
    expect(files["apps/api-core/src/infrastructure/database/schema/index.ts"]).toContain(
      "export const OrderStatusPgEnum = pgEnum(",
    );
    expect(
      files["apps/api-core/src/infrastructure/adapters/Order.drizzle.repository.ts"],
    ).toContain("class DrizzleOrderRepository implements OrderRepository");
    expect(
      files["apps/api-core/src/infrastructure/adapters/Customer.drizzle.repository.ts"],
    ).toContain("class DrizzleCustomerRepository implements CustomerRepository");
    expect(files["apps/api-core/src/infrastructure/adapters/drizzle-database.ts"]).toContain(
      "createDrizzleDatabase",
    );
    expect(files["apps/api-core/src/infrastructure/adapters/drizzle-database.ts"]).toContain(
      'neonConfig.fetchEndpoint = "http://127.0.0.1:4444/sql";',
    );
  });

  it("covers generated schemas, repository adapters, and query adapters", () => {
    const config = createValidConfig();
    config.entities.Order.fields.total = { type: "number", format: "decimal" };
    config.entities.Order.fields.submittedAt = { type: "date", default: { kind: "now" } };
    config.entities.OrderItem.fields.unitPrice = { type: "number", format: "decimal" };
    const summaryEndpoint = config.endpoints[0];
    if (!summaryEndpoint) throw new Error("Order summary endpoint fixture is missing.");
    const orderItemJoin = summaryEndpoint.joins[1];
    if (!orderItemJoin) throw new Error("OrderItem join fixture is missing.");
    orderItemJoin.fields.push("unitPrice");
    config.entities.Customer.timestamps = { createdAt: false, updatedAt: false };
    config.entities.Customer.fields.verifiedAt = { type: "date", default: "2026-01-01T00:00:00Z" };
    config.entities.Customer.fields.lastSeenAt = { type: "date", default: { kind: "now" } };
    config.entities.Customer.fields.credit = { type: "number", format: "decimal" };
    const userJoin = summaryEndpoint.joins[0];
    if (!userJoin) throw new Error("Customer join fixture is missing.");
    userJoin.fields.push("credit");
    summaryEndpoint.queryParams.push({
      name: "quantity",
      field: { entity: "OrderItem", field: "quantity" },
      required: false,
    });
    config.endpoints.push({
      backend: "core-api",
      path: "/api/orders/with-date",
      method: "POST",
      operationId: "createOrderWithDate",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      requestBody: {
        submittedAt: {
          field: { entity: "Order", field: "submittedAt" },
          required: false,
        },
      },
      joins: [{ entity: "Customer", type: "inner", fields: ["email"] }],
    });
    const result = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(config)),
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
    expect(orderAdapter).toContain('"total": Number(row.total)');
    expect(orderAdapter).toContain("items.map((row) => this.toDomain(row))");
    expect(
      files["apps/api-core/src/infrastructure/adapters/create-route-dependencies.ts"],
    ).not.toContain("CreateOrderUseCase");

    const userAdapter =
      files["apps/api-core/src/infrastructure/adapters/Customer.drizzle.repository.ts"];
    expect(userAdapter).toContain("class DrizzleCustomerRepository implements CustomerRepository");
    expect(userAdapter).toContain("deletedAt");

    const orderItemAdapter =
      files["apps/api-core/src/infrastructure/adapters/OrderItem.drizzle.repository.ts"];
    expect(orderItemAdapter).toContain(
      "class DrizzleOrderItemRepository implements OrderItemRepository",
    );
    expect(orderItemAdapter).not.toContain("deletedAt");
    expect(orderItemAdapter).not.toContain("isDeleted");

    const queryAdapter =
      files["apps/api-core/src/infrastructure/adapters/GetOrderSummary.drizzle.query.adapter.ts"];
    expect(
      files["apps/api-core/src/application/use-cases/dtos/endpoints/GetOrderSummary.dto.ts"],
    ).toContain('"quantity": z.preprocess');
    expect(queryAdapter).toBeDefined();
    expect(queryAdapter).toContain(
      "class DrizzleGetOrderSummaryQueryAdapter implements GetOrderSummaryQueryPort",
    );
    expect(queryAdapter).toContain("execute(input: QueryExecution): Promise<Response>");
    expect(queryAdapter).toContain("entity:  { ...row, total: Number(row.total) }");
    expect(queryAdapter).toContain(
      "OrderItem: Array.isArray(row.items) ? row.items.map((value: any) => ({ ...value, unitPrice: Number(value.unitPrice) })) : row.items ?? []",
    );
    expect(queryAdapter).toContain(
      "conditions.push(inArray(schema.OrderTable.customer_id, matchingRows));",
    );
    expect(queryAdapter).toContain("conditions.push(inArray(schema.OrderTable.id, matchingRows));");
    expect(queryAdapter).toContain(
      "Customer: row.customer == null ? null : { ...row.customer, credit: Number(row.customer.credit) },",
    );
    expect(queryAdapter).toContain(
      "from(schema.OrderTable).where(conditions.length > 0 ? and(...conditions) : undefined)",
    );
    expect(
      files["apps/api-core/src/infrastructure/adapters/create-route-dependencies.ts"],
    ).toContain("new CreateOrderWithDateEndpointUseCase(createOrderWithDateQueryAdapter, clock)");
  });

  it("covers custom unpaginated query adapter and diverse field types", () => {
    const config = createValidConfig();
    config.entities.Customer.fields = {
      ...config.entities.Customer.fields,
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
      joins: [{ entity: "Customer", type: "inner", fields: ["id", "email"] }],
    });

    const result = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(config)),
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
      files["apps/api-core/src/infrastructure/adapters/GetOrderDetails.drizzle.query.adapter.ts"];
    expect(detailsAdapter).toBeDefined();
    expect(detailsAdapter).toContain(
      "class DrizzleGetOrderDetailsQueryAdapter implements GetOrderDetailsQueryPort",
    );
  });

  it("wires custom CRUD endpoint adapters without joins", () => {
    const config = createSecuredConfig();
    config.endpoints = [
      {
        backend: "core-api",
        path: "/api/orders",
        method: "GET",
        operationId: "listOrdersPublicly",
        entity: "Order",
        authRequired: false,
        roles: [],
        permissions: [],
        queryParams: [],
        pathParams: [],
        pagination: "standard",
      },
      {
        backend: "core-api",
        path: "/api/orders",
        method: "POST",
        operationId: "createOrderEndpoint",
        entity: "Order",
        authRequired: true,
        roles: ["admin"],
        permissions: ["orders:create"],
        queryParams: [],
        pathParams: [],
        requestBody: { useCase: { entity: "Order", operation: "create" } },
      },
      {
        backend: "core-api",
        path: "/api/orders/{orderId}/customers/{customerId}",
        method: "PATCH",
        operationId: "updateOrderEndpoint",
        entity: "Order",
        authRequired: true,
        roles: ["admin"],
        permissions: ["orders:update"],
        queryParams: [],
        pathParams: [
          { name: "orderId", field: { entity: "Order", field: "id" } },
          { name: "customerId", field: { entity: "Order", field: "customer_id" } },
        ],
        requestBody: { useCase: { entity: "Order", operation: "update" } },
      },
      {
        backend: "core-api",
        path: "/api/orders/{orderId}",
        method: "DELETE",
        operationId: "deleteOrderEndpoint",
        entity: "Order",
        authRequired: true,
        roles: ["admin"],
        permissions: ["orders:delete"],
        queryParams: [],
        pathParams: [{ name: "orderId", field: { entity: "Order", field: "id" } }],
      },
    ];

    const result = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(config)),
      "core-api",
      createRegistry(),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    const dependencies =
      files["apps/api-core/src/infrastructure/adapters/create-route-dependencies.ts"];
    expect(dependencies).toContain('"listOrdersPublicly": listOrdersPubliclyEndpoint');
    expect(dependencies).toContain('"createOrderEndpoint": createOrderEndpointEndpoint');
    expect(dependencies).toContain('"updateOrderEndpoint": updateOrderEndpointEndpoint');
    expect(dependencies).toContain('"deleteOrderEndpoint": deleteOrderEndpointEndpoint');
    expect(
      files[
        "apps/api-core/src/infrastructure/adapters/ListOrdersPublicly.drizzle.query.adapter.ts"
      ],
    ).toContain("offset: pagination.offset");
    expect(
      files[
        "apps/api-core/src/infrastructure/adapters/ListOrdersPublicly.drizzle.query.adapter.ts"
      ],
    ).toContain(
      'case "contains": conditions.push(ilike(column, `%${String(filter.value)}%`)); break;',
    );
    expect(
      files[
        "apps/api-core/src/infrastructure/adapters/CreateOrderEndpoint.drizzle.query.adapter.ts"
      ],
    ).toContain("this.db.insert(schema.OrderTable)");
    expect(
      files[
        "apps/api-core/src/infrastructure/adapters/UpdateOrderEndpoint.drizzle.query.adapter.ts"
      ],
    ).toContain("this.db.update(schema.OrderTable)");
    expect(
      files[
        "apps/api-core/src/infrastructure/adapters/UpdateOrderEndpoint.drizzle.query.adapter.ts"
      ],
    ).toContain('input.request["orderId"]');
    expect(
      files[
        "apps/api-core/src/infrastructure/adapters/UpdateOrderEndpoint.drizzle.query.adapter.ts"
      ],
    ).toContain('eq(schema.OrderTable.customer_id, input.request["customerId"])');
    expect(
      files[
        "apps/api-core/src/infrastructure/adapters/DeleteOrderEndpoint.drizzle.query.adapter.ts"
      ],
    ).toContain("this.db.delete(schema.OrderTable)");
  });

  it("handles entities without soft delete and timestamp soft delete query adapters", () => {
    const userSummaryConfig = createValidConfig();
    userSummaryConfig.entities.Customer.softDelete = "timestamp";
    userSummaryConfig.entities.Customer.relations.orders = {
      type: "one-to-many",
      target: "Order",
      foreignKey: "customer_id",
    };
    userSummaryConfig.endpoints.push({
      path: "/api/user/summary",
      method: "GET",
      operationId: "getCustomerSummary",
      backend: "core-api",
      entity: "Customer",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      joins: [{ entity: "Order", type: "left", fields: ["total"] }],
    });
    const userSummaryResult = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(userSummaryConfig)),
      "core-api",
      createRegistry(),
    );
    expect(userSummaryResult.success).toBe(true);
    if (!userSummaryResult.success) return;
    const userSummaryFiles = userSummaryResult.virtualFileSystem.snapshot();
    expect(
      userSummaryFiles[
        "apps/api-core/src/infrastructure/adapters/GetCustomerSummary.drizzle.query.adapter.ts"
      ],
    ).toContain("deletedAt");

    const falseDeleteConfig = createValidConfig();
    falseDeleteConfig.entities.Order.softDelete = false;
    falseDeleteConfig.endpoints = [
      {
        path: "/api/orders/auto",
        operationId: "getApiOrdersAuto",
        method: "GET",
        backend: "core-api",
        entity: "Order",
        authRequired: false,
        roles: [],
        permissions: [],
        queryParams: [],
        pathParams: [],
        joins: [{ entity: "Customer", type: "left", fields: ["id"] }],
      },
    ];
    const falseDeleteResult = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(falseDeleteConfig)),
      "core-api",
      createRegistry(),
    );
    expect(falseDeleteResult.success).toBe(true);
    if (!falseDeleteResult.success) return;
    const falseDeleteFiles = falseDeleteResult.virtualFileSystem.snapshot();
    expect(
      falseDeleteFiles[
        "apps/api-core/src/infrastructure/adapters/GetApiOrdersAuto.drizzle.query.adapter.ts"
      ],
    ).toBeDefined();
  });

  it("covers schemas without relations, one-to-one relations, and findPage filtering", () => {
    const config = createValidConfig();
    config.entities.Customer.fields.weight = { type: "number", precision: 6 };
    config.entities.Customer.fields.balance = { type: "number", format: "decimal", scale: 4 };
    config.entities.Customer.relations.profile = { type: "one-to-one", target: "Profile" };
    config.entities.Profile = { backend: "core-api", fields: { label: { type: "string" } } };
    config.backends[0].modules.commerce.entities.push("Profile");

    config.entities.OrderItem.softDelete = false;
    config.pagination.compact = {
      strategy: "offset",
      defaultPageSize: 10,
      maxPageSize: 50,
    };
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
      pagination: "compact",
      joins: [],
    });
    const resultWithOne = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(config)),
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
    config.entities.Customer.fields.role = { type: "string" };
    config.entities.Order.fields.status = { type: "string" };
    config.entities.Customer.relations = {};
    config.entities.Order.relations = {};
    config.entities.OrderItem.relations = {};
    config.endpoints = [];
    const result = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(config)),
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

  it("creates a related-entity subquery for one-to-many filters", () => {
    const config = createValidConfig();
    config.endpoints = [
      {
        backend: "core-api",
        path: "/api/orders/by-quantity",
        method: "GET",
        operationId: "getOrdersByQuantity",
        entity: "Order",
        queryParams: [
          { name: "quantity", field: { entity: "OrderItem", field: "quantity" }, required: false },
        ],
        joins: [{ entity: "OrderItem", type: "left", fields: ["quantity"] }],
      },
    ];
    const context = createDrizzleContext();
    context.domainModel = backendView(resolvedFixture(config), "core-api");
    const adapter = generateDrizzleAdapterFiles(context, createValidPersistenceContext()).find(
      (file) => file.path.endsWith("GetOrdersByQuantity.drizzle.query.adapter.ts"),
    );
    expect(adapter?.content).toContain(
      "conditions.push(inArray(schema.OrderTable.id, matchingRows));",
    );
  });

  it("generates migration runner, README, and deterministic topological seeders", () => {
    const config = createValidConfig();
    config.entities.Customer.fields.name = { type: "string" };
    config.entities.Customer.fields.shortCode = { type: "string", maxLength: 10 };
    config.entities.Customer.fields.externalReference = { type: "string", maxLength: 32 };
    config.entities.Customer.fields.bio = { type: "string", maxLength: 200 };
    config.entities.Customer.fields.age = { type: "number", format: "integer" };
    config.entities.Customer.fields.score = { type: "number", format: "float" };
    config.entities.Customer.fields.isActive = { type: "boolean" };
    config.entities.Customer.fields.birthDate = { type: "date" };
    config.entities.Customer.fields.externalId = { type: "uuid" };
    config.entities.Customer.fields.metadata = { type: "json" };
    config.entities.Customer.fields.optionalNotes = { type: "string", required: false };

    const result = composeBackendPlugins(
      resolvedFixture(NordixConfigSchema.parse(config)),
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
    expect(migrateFile).toContain("pathToFileURL(resolve(process.argv[1])).href");

    expect(readmeFile).toBeDefined();
    expect(readmeFile).toContain("# Database Management & Migrations");
    expect(readmeFile).toContain("pnpm drizzle-kit generate");

    expect(seedFile).toBeDefined();
    expect(seedFile).toContain("@faker-js/faker");
    expect(seedFile).toContain("faker.seed(seedValue);");
    expect(seedFile).toContain("faker.internet.email()");
    expect(seedFile).toContain("faker.person.fullName()");
    expect(seedFile).toContain("faker.string.alphanumeric(10)");
    expect(seedFile).toContain("(faker.lorem.sentence()).slice(0, 32)");
    expect(seedFile).toContain("faker.number.int({ min: 1, max: 1000 })");
    expect(seedFile).toContain("faker.datatype.boolean()");
    expect(seedFile).toContain("faker.string.uuid()");
    expect(seedFile).toContain("faker.helpers.arrayElement");
    expect(seedFile).toContain("pathToFileURL(resolve(process.argv[1])).href");

    // Verify topological order in seeder: Customer before Order before OrderItem
    const userIndex = seedFile.indexOf("// Seed Customer");
    const orderIndex = seedFile.indexOf("// Seed Order");
    const orderItemIndex = seedFile.indexOf("// Seed OrderItem");
    expect(userIndex).toBeGreaterThan(-1);
    expect(orderIndex).toBeGreaterThan(userIndex);
    expect(orderItemIndex).toBeGreaterThan(orderIndex);
  });
});
