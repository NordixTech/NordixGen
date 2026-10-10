import { posix } from "node:path";
import type { FieldDefinition, RelationDefinition } from "../../configuration/schema.js";
import type { DomainModelContext, GeneratedFile, PluginContributionContext } from "../contracts.js";

function importPath(fromFile: string, targetFile: string): string {
  const path = posix.relative(posix.dirname(fromFile), targetFile.replace(/\.ts$/, ".js"));
  return path.startsWith(".") ? path : `./${path}`;
}

function pgEnumName(enumName: string): string {
  return `${enumName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}_enum`;
}

function pgTableName(entityName: string): string {
  return entityName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function pgColumnName(fieldName: string): string {
  return fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function drizzleColumnBuilder(fieldName: string, field: FieldDefinition): string {
  const colName = pgColumnName(fieldName);
  let builder: string;

  if (fieldName === "id") {
    return `uuid(${JSON.stringify(colName)}).primaryKey().defaultRandom()`;
  }

  switch (field.type) {
    case "string":
      if (field.maxLength !== undefined) {
        builder = `varchar(${JSON.stringify(colName)}, { length: ${field.maxLength} })`;
      } else {
        builder = `text(${JSON.stringify(colName)})`;
      }
      break;
    case "uuid":
      builder = `uuid(${JSON.stringify(colName)})`;
      break;
    case "number":
      if (field.format === "integer") {
        builder = `integer(${JSON.stringify(colName)})`;
      } else if (field.format === "decimal" || field.precision !== undefined) {
        builder = `numeric(${JSON.stringify(colName)}, { precision: ${field.precision ?? 10}, scale: ${field.scale ?? 2} })`;
      } else {
        builder = `doublePrecision(${JSON.stringify(colName)})`;
      }
      break;
    case "boolean":
      builder = `boolean(${JSON.stringify(colName)})`;
      break;
    case "date":
      builder = `timestamp(${JSON.stringify(colName)}, { withTimezone: true, mode: "date" })`;
      break;
    case "json":
      builder = `jsonb(${JSON.stringify(colName)})`;
      break;
    case "enum":
      builder = `${field.enumName}PgEnum(${JSON.stringify(colName)})`;
      break;
  }

  if (field.required !== false) {
    builder += ".notNull()";
  }

  if (field.unique) {
    builder += ".unique()";
  }

  if (field.default !== undefined) {
    if (field.type === "date") {
      if (
        typeof field.default === "object" &&
        field.default !== null &&
        "kind" in field.default &&
        field.default.kind === "now"
      ) {
        builder += ".defaultNow()";
      } else {
        builder += `.default(sql\`\${new Date(${JSON.stringify(field.default)}).toISOString()}::timestamptz\`)`;
      }
    } else if (field.type === "boolean" || field.type === "number") {
      builder += `.default(${JSON.stringify(field.default)})`;
    } else if (field.type === "string" || field.type === "enum") {
      builder += `.default(${JSON.stringify(field.default)})`;
    }
  }

  return builder;
}

export function generateDrizzleSchemaFiles(
  context: PluginContributionContext,
  persistence: NonNullable<PluginContributionContext["persistence"]>,
): readonly GeneratedFile[] {
  const model = context.domainModel;
  if (!model) return [];

  const schemaDirectory = posix.join(persistence.directories.infrastructure, "database/schema");
  const schemaIndexPath = posix.join(schemaDirectory, "index.ts");

  const files: GeneratedFile[] = [];

  const enumDeclarations = Object.entries(model.enums)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([enumName, values]) =>
        `export const ${enumName}PgEnum = pgEnum(${JSON.stringify(pgEnumName(enumName))}, [${values.map((v) => JSON.stringify(v)).join(", ")}]);`,
    );

  const tableImports = new Set<string>([
    "pgTable",
    "text",
    "varchar",
    "uuid",
    "integer",
    "numeric",
    "doublePrecision",
    "boolean",
    "timestamp",
    "jsonb",
    "pgEnum",
  ]);

  const tableDefinitions: string[] = [];

  for (const [entityName, entity] of Object.entries(model.entities).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const tableName = pgTableName(entityName);
    const varName = `${entityName}Table`;

    const columnDefs: string[] = [];
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      columnDefs.push(`  ${fieldName}: ${drizzleColumnBuilder(fieldName, field)},`);
    }

    tableDefinitions.push(
      `export const ${varName} = pgTable(${JSON.stringify(tableName)}, {\n${columnDefs.join("\n")}\n});`,
    );
  }

  // Relations declarations for Drizzle relational queries
  const relationDefinitions: string[] = [];
  for (const [entityName, entity] of Object.entries(model.entities).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (Object.keys(entity.relations).length === 0) continue;
    const varName = `${entityName}Table`;

    const relFields: string[] = [];
    for (const [relName, rel] of Object.entries(entity.relations)) {
      const targetTable = `${rel.target}Table`;
      if (rel.type === "many-to-one") {
        const foreignKeyCol = rel.foreignKey ?? `${rel.target.toLowerCase()}_id`;
        relFields.push(
          `  ${relName}: one(${targetTable}, { fields: [${varName}.${foreignKeyCol}], references: [${targetTable}.id] }),`,
        );
      } else if (rel.type === "one-to-many") {
        relFields.push(`  ${relName}: many(${targetTable}),`);
      } else if (rel.type === "one-to-one") {
        const foreignKeyCol = rel.foreignKey ?? `${rel.target.toLowerCase()}_id`;
        relFields.push(
          `  ${relName}: one(${targetTable}, { fields: [${varName}.${foreignKeyCol}], references: [${targetTable}.id] }),`,
        );
      }
    }

    if (relFields.length > 0) {
      relationDefinitions.push(
        `export const ${entityName}Relations = relations(${varName}, ({ one, many }) => ({\n${relFields.join("\n")}\n}));`,
      );
    }
  }

  const hasRelations = relationDefinitions.length > 0;
  const drizzleOrmImports = ["sql", ...(hasRelations ? ["relations"] : [])];

  const schemaContent = [
    `import { ${drizzleOrmImports.join(", ")} } from "drizzle-orm";`,
    `import { ${[...tableImports].sort().join(", ")} } from "drizzle-orm/pg-core";`,
    "",
    ...(enumDeclarations.length > 0 ? [...enumDeclarations, ""] : []),
    ...tableDefinitions.flatMap((t) => [t, ""]),
    ...(relationDefinitions.length > 0 ? [...relationDefinitions, ""] : []),
  ].join("\n");

  files.push({
    path: schemaIndexPath,
    content: schemaContent,
  });

  return files;
}

export function generateDrizzleAdapterFiles(
  context: PluginContributionContext,
  persistence: NonNullable<PluginContributionContext["persistence"]>,
): readonly GeneratedFile[] {
  const model = context.domainModel;
  if (!model) return [];

  const adapterDirectory = persistence.directories.adapter;
  const schemaDirectory = posix.join(persistence.directories.infrastructure, "database/schema");
  const schemaIndexPath = posix.join(schemaDirectory, "index.ts");
  const entityDirectory = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.domainEntity,
  );
  const outboundPortDirectory = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.outboundPort,
  );

  const files: GeneratedFile[] = [];

  // Generate database client helper
  const dbClientPath = posix.join(adapterDirectory, "drizzle-database.ts");
  files.push({
    path: dbClientPath,
    content: [
      'import { neon } from "@neondatabase/serverless";',
      'import { drizzle } from "drizzle-orm/neon-http";',
      `import * as schema from "${importPath(dbClientPath, schemaIndexPath)}";`,
      "",
      "export type DrizzleDatabase = ReturnType<typeof createDrizzleDatabase>;",
      "",
      "export function createDrizzleDatabase(connectionString: string) {",
      "  const client = neon(connectionString);",
      "  return drizzle(client, { schema });",
      "}",
      "",
    ].join("\n"),
  });

  // Generate repository adapters for each entity
  for (const [entityName, entity] of Object.entries(model.entities).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const adapterPath = posix.join(adapterDirectory, `${entityName}.drizzle.repository.ts`);
    const entityPath = posix.join(entityDirectory, `${entityName}.entity.ts`);
    const repositoryPortPath = posix.join(outboundPortDirectory, `${entityName}.repository.ts`);

    const softDeleteCondition =
      entity.softDelete === "boolean"
        ? `eq(schema.${entityName}Table.isDeleted, false)`
        : entity.softDelete === "timestamp"
          ? `isNull(schema.${entityName}Table.deletedAt)`
          : undefined;

    const softDeleteDeleteStatement =
      entity.softDelete === "boolean"
        ? `await this.db.update(schema.${entityName}Table).set({ isDeleted: true }).where(eq(schema.${entityName}Table.id, id));`
        : entity.softDelete === "timestamp"
          ? `await this.db.update(schema.${entityName}Table).set({ deletedAt: new Date() }).where(eq(schema.${entityName}Table.id, id));`
          : `await this.db.delete(schema.${entityName}Table).where(eq(schema.${entityName}Table.id, id));`;

    const supportsPagination = model.endpoints.some(
      (endpoint) => endpoint.entity === entityName && endpoint.pagination !== undefined,
    );

    const adapterContent = [
      'import { and, eq, isNull, sql } from "drizzle-orm";',
      `import type { ${entityName}, Create${entityName}Input } from "${importPath(adapterPath, entityPath)}";`,
      `import type { ${entityName}Repository } from "${importPath(adapterPath, repositoryPortPath)}";`,
      `import type { DrizzleDatabase } from "${importPath(adapterPath, dbClientPath)}";`,
      `import * as schema from "${importPath(adapterPath, schemaIndexPath)}";`,
      "",
      `export class Drizzle${entityName}Repository implements ${entityName}Repository {`,
      "  constructor(private readonly db: DrizzleDatabase) {}",
      "",
      `  async findById(id: string): Promise<${entityName} | null> {`,
      `    const conditions = [eq(schema.${entityName}Table.id, id)${softDeleteCondition ? `, ${softDeleteCondition}` : ""}];`,
      `    const result = await this.db.select().from(schema.${entityName}Table).where(and(...conditions)).limit(1);`,
      `    return (result[0] as ${entityName}) ?? null;`,
      "  }",
      "",
      `  async findMany(filter?: Partial<${entityName}>): Promise<readonly ${entityName}[]> {`,
      "    const conditions: any[] = [];",
      ...(softDeleteCondition ? [`    conditions.push(${softDeleteCondition});`] : []),
      "    if (filter) {",
      "      for (const [key, value] of Object.entries(filter)) {",
      "        if (value !== undefined) {",
      `          const column = (schema.${entityName}Table as any)[key];`,
      "          if (column) conditions.push(eq(column, value));",
      "        }",
      "      }",
      "    }",
      `    const query = this.db.select().from(schema.${entityName}Table);`,
      "    if (conditions.length > 0) query.where(and(...conditions));",
      `    return (await query) as readonly ${entityName}[];`,
      "  }",
      ...(supportsPagination
        ? [
            "",
            `  async findPage(filter: Partial<${entityName}>, offset: number, limit: number): Promise<{ items: readonly ${entityName}[]; total: number }> {`,
            "    const conditions: any[] = [];",
            ...(softDeleteCondition ? [`    conditions.push(${softDeleteCondition});`] : []),
            "    if (filter) {",
            "      for (const [key, value] of Object.entries(filter)) {",
            "        if (value !== undefined) {",
            `          const column = (schema.${entityName}Table as any)[key];`,
            "          if (column) conditions.push(eq(column, value));",
            "        }",
            "      }",
            "    }",
            `    const baseQuery = this.db.select().from(schema.${entityName}Table);`,
            "    if (conditions.length > 0) baseQuery.where(and(...conditions));",
            `    const items = (await baseQuery.offset(offset).limit(limit)) as readonly ${entityName}[];`,
            `    const countQuery = this.db.select({ count: sql\`count(*)\` }).from(schema.${entityName}Table);`,
            "    if (conditions.length > 0) countQuery.where(and(...conditions));",
            "    const countResult = await countQuery;",
            "    const total = Number(countResult[0]?.count ?? 0);",
            "    return { items, total };",
            "  }",
          ]
        : []),
      "",
      `  async create(input: Create${entityName}Input): Promise<${entityName}> {`,
      `    const result = await this.db.insert(schema.${entityName}Table).values(input as any).returning();`,
      `    return result[0] as ${entityName};`,
      "  }",
      "",
      `  async update(id: string, changes: Partial<Omit<${entityName}, "id">>): Promise<${entityName} | null> {`,
      `    const conditions = [eq(schema.${entityName}Table.id, id)${softDeleteCondition ? `, ${softDeleteCondition}` : ""}];`,
      `    const result = await this.db.update(schema.${entityName}Table).set(changes as any).where(and(...conditions)).returning();`,
      `    return (result[0] as ${entityName}) ?? null;`,
      "  }",
      "",
      `  async save(entity: ${entityName}): Promise<${entityName}> {`,
      "    const existing = await this.findById(entity.id);",
      "    if (existing) {",
      "      const { id, ...changes } = entity;",
      "      const updated = await this.update(id, changes);",
      "      if (!updated) throw new Error(`Failed to update ${entityName} with id ${id}`);",
      "      return updated;",
      "    }",
      "    return this.create(entity as any);",
      "  }",
      "",
      "  async delete(id: string): Promise<void> {",
      `    ${softDeleteDeleteStatement}`,
      "  }",
      "}",
      "",
    ].join("\n");

    files.push({ path: adapterPath, content: adapterContent });
  }

  // Generate query port adapters for custom endpoints with joins
  for (const endpoint of model.endpoints) {
    if (!endpoint.joins || endpoint.joins.length === 0) continue;
    const operationName =
      endpoint.operationId ??
      `${endpoint.method.toLowerCase()}${endpoint.path.replace(/[^a-zA-Z0-9]/g, "")}`;
    const adapterPath = posix.join(adapterDirectory, `${operationName}.drizzle.query.adapter.ts`);
    const portPath = posix.join(outboundPortDirectory, `${operationName}.query.port.ts`);
    const dtoPath = posix.join(
      context.framework.codeRoot,
      context.architecture.directories.useCase,
      "dtos",
      "endpoints",
      `${operationName}.dto.ts`,
    );

    const mainEntity = model.entities[endpoint.entity];
    if (!mainEntity) continue;
    const softDeleteCondition =
      mainEntity.softDelete === "boolean"
        ? `eq(schema.${endpoint.entity}Table.isDeleted, false)`
        : mainEntity.softDelete === "timestamp"
          ? `isNull(schema.${endpoint.entity}Table.deletedAt)`
          : undefined;

    const resolveJoinRelName = (targetEntity: string) => {
      for (const [relName, rel] of Object.entries(mainEntity.relations)) {
        if (rel.target === targetEntity) return relName;
      }
      return targetEntity.toLowerCase();
    };

    const joinsQueryConfig: string[] = [];
    for (const join of endpoint.joins) {
      const relName = resolveJoinRelName(join.entity);
      const fieldsSelection = Object.fromEntries(join.fields.map((f) => [f, true]));
      joinsQueryConfig.push(`        ${relName}: { columns: ${JSON.stringify(fieldsSelection)} },`);
    }

    const adapterContent = [
      'import { and, eq, isNull, sql } from "drizzle-orm";',
      `import type { ${operationName}QueryPort } from "${importPath(adapterPath, portPath)}";`,
      `import type { QueryExecution, Response } from "${importPath(adapterPath, dtoPath)}";`,
      `import type { DrizzleDatabase } from "${importPath(adapterPath, dbClientPath)}";`,
      `import * as schema from "${importPath(adapterPath, schemaIndexPath)}";`,
      "",
      `export class Drizzle${operationName}QueryAdapter implements ${operationName}QueryPort {`,
      "  constructor(private readonly db: DrizzleDatabase) {}",
      "",
      "  async execute(input: QueryExecution): Promise<Response> {",
      "    const conditions: any[] = [];",
      ...(softDeleteCondition ? [`    conditions.push(${softDeleteCondition});`] : []),
      "    for (const filter of input.filters) {",
      "      const table = (schema as any)[`${filter.entity}Table`];",
      "      if (table && table[filter.field]) {",
      "        conditions.push(eq(table[filter.field], filter.value));",
      "      }",
      "    }",
      "",
      ...(endpoint.pagination
        ? [
            "    const pagination = input.pagination;",
            `    const itemsRaw = await (this.db.query as any).${endpoint.entity}Table.findMany({`,
            "      where: conditions.length > 0 ? and(...conditions) : undefined,",
            "      offset: pagination.offset,",
            "      limit: pagination.limit,",
            "      with: {",
            ...joinsQueryConfig,
            "      },",
            "    });",
            `    const countResult = await this.db.select({ count: sql\`count(*)\` }).from(schema.${endpoint.entity}Table);`,
            "    const total = Number(countResult[0]?.count ?? 0);",
            "    const items = itemsRaw.map((row: any) => ({",
            "      entity: row,",
            "      joins: {",
            ...endpoint.joins.map((join) => {
              const relName = resolveJoinRelName(join.entity);
              return `        ${join.entity}: row.${relName} ?? null,`;
            }),
            "      },",
            "    }));",
            "    const page = Math.floor(pagination.offset / pagination.limit) + 1;",
            "    const pageSize = pagination.limit;",
            "    return { items, total, page, pageSize } as Response;",
          ]
        : [
            `    const itemsRaw = await (this.db.query as any).${endpoint.entity}Table.findMany({`,
            "      where: conditions.length > 0 ? and(...conditions) : undefined,",
            "      with: {",
            ...joinsQueryConfig,
            "      },",
            "    });",
            "    return itemsRaw.map((row: any) => ({",
            "      entity: row,",
            "      joins: {",
            ...endpoint.joins.map((join) => {
              const relName = resolveJoinRelName(join.entity);
              return `        ${join.entity}: row.${relName} ?? null,`;
            }),
            "      },",
            "    })) as Response;",
          ]),
      "  }",
      "}",
      "",
    ].join("\n");

    files.push({ path: adapterPath, content: adapterContent });
  }

  return files;
}

export function generateDrizzleMigrationFiles(
  context: PluginContributionContext,
  persistence: NonNullable<PluginContributionContext["persistence"]>,
): readonly GeneratedFile[] {
  const model = context.domainModel;
  if (!model) return [];

  const infrastructureDir = persistence.directories.infrastructure;
  const dbDir = posix.join(infrastructureDir, "database");
  const migratePath = posix.join(dbDir, "migrate.ts");
  const readmePath = posix.join(dbDir, "README.md");

  const migrateContent = [
    'import { neon } from "@neondatabase/serverless";',
    'import { drizzle } from "drizzle-orm/neon-http";',
    'import { migrate } from "drizzle-orm/neon-http/migrator";',
    "",
    `const connectionString = process.env.${persistence.connectionStringEnvironmentVariable};`,
    "if (!connectionString) {",
    `  throw new Error("Set ${persistence.connectionStringEnvironmentVariable} before running database migrations.");`,
    "}",
    "",
    "export async function runMigrations(): Promise<void> {",
    "  const sql = neon(connectionString);",
    "  const db = drizzle(sql);",
    '  console.log("Applying pending Drizzle migrations...");',
    '  await migrate(db, { migrationsFolder: "./drizzle" });',
    '  console.log("Migrations applied successfully.");',
    "}",
    "",
    'if (import.meta.url === `file://${process.argv[1]}`) {',
    "  runMigrations().catch((error) => {",
    '    console.error("Migration failed:", error);',
    "    process.exit(1);",
    "  });",
    "}",
    "",
  ].join("\n");

  const readmeContent = [
    "# Database Management & Migrations",
    "",
    `Target database: **${persistence.database.name}** (${persistence.database.engine} via ${persistence.database.provider}).`,
    "",
    "## 1. Generate Migrations",
    "Generate SQL migration files from Drizzle schema definitions:",
    "```bash",
    "pnpm drizzle-kit generate",
    "```",
    "",
    "## 2. Apply Migrations",
    `Apply pending migrations using the \`${persistence.connectionStringEnvironmentVariable}\` connection string:`,
    "```bash",
    "pnpm tsx src/infrastructure/database/migrate.ts",
    "```",
    "",
    "## 3. Seed Database",
    "Seed deterministic synthetic fixtures generated according to domain contracts:",
    "```bash",
    "pnpm tsx src/infrastructure/database/seed.ts",
    "```",
    "",
  ].join("\n");

  return [
    { path: migratePath, content: migrateContent },
    { path: readmePath, content: readmeContent },
  ];
}

export function generateDrizzleSeedFiles(
  context: PluginContributionContext,
  persistence: NonNullable<PluginContributionContext["persistence"]>,
): readonly GeneratedFile[] {
  const model = context.domainModel;
  if (!model) return [];

  const infrastructureDir = persistence.directories.infrastructure;
  const dbDir = posix.join(infrastructureDir, "database");
  const seedPath = posix.join(dbDir, "seed.ts");
  const schemaIndexPath = posix.join(infrastructureDir, "database/schema/index.ts");
  const adapterDirectory = persistence.directories.adapter;
  const dbClientPath = posix.join(adapterDirectory, "drizzle-database.ts");

  const orderedEntityNames = (model.entityOrder ?? Object.keys(model.entities)).filter(
    (name) => name in model.entities,
  );

  const entitySeeders: string[] = [];
  for (const entityName of orderedEntityNames) {
    const entity = model.entities[entityName] as NonNullable<
      (typeof model.entities)[keyof typeof model.entities]
    >;

    const fieldAssignments: string[] = [];

    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (fieldName === "id") continue;
      if (fieldName === "createdAt" || fieldName === "updatedAt") {
        fieldAssignments.push(`        ${fieldName}: faker.date.recent(),`);
        continue;
      }
      if (fieldName === "isDeleted") {
        fieldAssignments.push(`        ${fieldName}: false,`);
        continue;
      }
      if (fieldName === "deletedAt") {
        fieldAssignments.push(`        ${fieldName}: null,`);
        continue;
      }

      let valueExpression = "faker.lorem.word()";
      switch (field.type) {
        case "string":
          if (fieldName.toLowerCase().includes("email")) {
            valueExpression = "faker.internet.email()";
          } else if (fieldName.toLowerCase().includes("name")) {
            valueExpression = "faker.person.fullName()";
          } else if (field.maxLength !== undefined && field.maxLength <= 20) {
            valueExpression = `faker.string.alphanumeric(${field.maxLength})`;
          } else {
            valueExpression = "faker.lorem.sentence()";
          }
          break;
        case "number":
          if (field.format === "integer") {
            valueExpression = "faker.number.int({ min: 1, max: 1000 })";
          } else {
            valueExpression = "faker.number.float({ min: 1, max: 1000, fractionDigits: 2 })";
          }
          break;
        case "boolean":
          valueExpression = "faker.datatype.boolean()";
          break;
        case "date":
          valueExpression = "faker.date.recent()";
          break;
        case "uuid":
          valueExpression = "faker.string.uuid()";
          break;
        case "json":
          valueExpression = '{ meta: faker.lorem.word(), count: faker.number.int({ min: 1, max: 10 }) }';
          break;
        case "enum": {
          const enumValues = model.enums[field.enumName];
          valueExpression = `faker.helpers.arrayElement(${JSON.stringify(enumValues)})`;
          break;
        }
      }

      if (field.required === false && field.default === undefined) {
        fieldAssignments.push(`        ${fieldName}: faker.datatype.boolean() ? ${valueExpression} : null,`);
      } else {
        fieldAssignments.push(`        ${fieldName}: ${valueExpression},`);
      }
    }

    // Assign foreign keys from previously seeded parent entities
    for (const [relName, rel] of Object.entries(entity.relations)) {
      if (rel.type === "many-to-one" || rel.type === "one-to-one") {
        const foreignKeyCol = rel.foreignKey ?? `${rel.target.toLowerCase()}_id`;
        fieldAssignments.push(
          `        ${foreignKeyCol}: seeded.${rel.target}.length > 0 ? faker.helpers.arrayElement(seeded.${rel.target}).id : null,`,
        );
      }
    }

    entitySeeders.push(`    // Seed ${entityName} (deterministic synthetic records)
    seeded.${entityName} = [];
    for (let i = 0; i < 5; i++) {
      const record = {
${fieldAssignments.join("\n")}
      };
      const [inserted] = await db.insert(schema.${entityName}Table).values(record as any).returning();
      if (inserted) {
        seeded.${entityName}.push(inserted);
      }
    }
    console.log(\`Seeded \${seeded.${entityName}.length} records for ${entityName}\`);`);
  }

  const seedContent = [
    'import { faker } from "@faker-js/faker";',
    `import { createDrizzleDatabase } from "${importPath(seedPath, dbClientPath)}";`,
    `import * as schema from "${importPath(seedPath, schemaIndexPath)}";`,
    "",
    `const connectionString = process.env.${persistence.connectionStringEnvironmentVariable};`,
    "if (!connectionString) {",
    `  throw new Error("Set ${persistence.connectionStringEnvironmentVariable} before running database seed.");`,
    "}",
    "",
    "export async function seedDatabase(options?: { seed?: number }): Promise<Record<string, any[]>> {",
    "  const seedValue = options?.seed ?? 42;",
    "  faker.seed(seedValue);",
    "  const db = createDrizzleDatabase(connectionString);",
    "  const seeded: Record<string, any[]> = {};",
    "",
    ...entitySeeders,
    "",
    "  return seeded;",
    "}",
    "",
    'if (import.meta.url === `file://${process.argv[1]}`) {',
    "  seedDatabase().catch((error) => {",
    '    console.error("Seeding failed:", error);',
    "    process.exit(1)",
    "  });",
    "}",
    "",
  ].join("\n");

  return [{ path: seedPath, content: seedContent }];
}
