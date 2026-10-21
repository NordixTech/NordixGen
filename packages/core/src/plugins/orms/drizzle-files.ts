import { posix } from "node:path";
import type { ResolvedField } from "../../project/types.js";
import { resolveArchitectureLayout } from "../architecture/layout.js";
import type {
  BackendRenderContext,
  DomainModelContext,
  GeneratedFile,
  PersistenceContext,
} from "../contracts.js";

function importPath(fromFile: string, targetFile: string): string {
  const path = posix.relative(posix.dirname(fromFile), targetFile.replace(/\.ts$/, ".js"));
  return path.startsWith(".") ? path : `./${path}`;
}

function endpointTypeName(endpoint: DomainModelContext["endpoints"][number]): string {
  return endpoint.typeName;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function drizzleColumnBuilder(fieldName: string, field: ResolvedField): string {
  const colName = field.column;
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
      } else if (field.format === "decimal") {
        builder = `numeric(${JSON.stringify(colName)}, { precision: ${field.precision}, scale: ${field.scale} })`;
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

  if (field.generated === "created-at" || field.generated === "updated-at") {
    builder += ".defaultNow()";
  }

  if (field.default !== undefined && field.default !== null) {
    if (field.type === "date") {
      if (field.defaultValue.kind === "clock") {
        builder += ".defaultNow()";
      } else {
        const instant = new Date(field.default as string).toISOString();
        builder += `.default(sql.raw(${JSON.stringify(`'${instant}'::timestamptz`)}))`;
      }
    } else if (field.type === "number" && field.format === "decimal") {
      // Drizzle numeric columns use string values at the persistence boundary.
      // Application/HTTP defaults remain numbers in the resolved model and DTOs.
      builder += `.default(${JSON.stringify(String(field.default))})`;
    } else {
      builder += `.default(${JSON.stringify(field.default)})`;
    }
  }

  return builder;
}

export function generateDrizzleSchemaFiles(
  context: BackendRenderContext,
  persistence: PersistenceContext,
): readonly GeneratedFile[] {
  const model = context.domainModel;
  const directory = persistence.directories.schema;
  const indexPath = posix.join(directory, "index.ts");
  if (!context.moduleId) {
    const used = new Set(
      Object.values(model.entities).flatMap((entity) =>
        Object.values(entity.fields).flatMap((field) =>
          field.type === "enum" ? [field.enumName] : [],
        ),
      ),
    );
    return [
      {
        path: posix.join(directory, "enums.ts"),
        content: [
          'import {pgEnum} from "drizzle-orm/pg-core";',
          ...Object.entries(model.enums)
            .filter(([name]) => used.has(name))
            .map(
              ([name, values]) =>
                `export const ${name}PgEnum = pgEnum(${JSON.stringify(model.enumSqlNames[name])},[${values.map((value) => JSON.stringify(value)).join(",")}]);`,
            ),
          "",
        ].join("\n"),
      },
      {
        path: indexPath,
        content: [
          ...model.modules.map(
            (module) =>
              `export * from "${importPath(indexPath, posix.join(context.moduleRoots[module.id], resolveArchitectureLayout(module.architecture).schema, "index.ts"))}";`,
          ),
          'export * from "./enums.js";',
          'export * from "./audit-schema.js";',
          ...(context.identity
            ? ['export * from "./auth-schema.js";', 'export * from "./iam-schema.js";']
            : []),
          "",
        ].join("\n"),
      },
    ];
  }
  const files: GeneratedFile[] = [];
  for (const name of model.entityOrder) {
    const entity = model.entities[name];
    const tablePath = posix.join(directory, `${name}.table.ts`);
    const owning = Object.values(entity.relations).filter(
      (relation) => relation.type === "many-to-one" || relation.type === "one-to-one",
    );
    const enumNames = [
      ...new Set(
        Object.values(entity.fields).flatMap((field) =>
          field.type === "enum" ? [field.enumName] : [],
        ),
      ),
    ];
    const columns = Object.entries(entity.fields).map(([fieldName, field]) => {
      let builder = drizzleColumnBuilder(fieldName, field);
      const relation = owning.find((relation) => relation.foreignKey === fieldName);
      if (relation)
        builder += `.references(() => ${relation.target}Table.id, { onDelete: ${JSON.stringify(relation.onDelete === "set-null" ? "set null" : relation.onDelete === "no-action" ? "no action" : relation.onDelete)} })`;
      return `${JSON.stringify(fieldName)}:${builder},`;
    });
    files.push({
      path: tablePath,
      content: [
        'import {sql} from "drizzle-orm";',
        'import {pgTable,text,varchar,uuid,integer,numeric,doublePrecision,boolean,timestamp,jsonb} from "drizzle-orm/pg-core";',
        ...[...new Set(owning.map((relation) => relation.target))]
          .sort()
          .map((target) => `import {${target}Table} from "./${target}.table.js";`),
        ...(enumNames.length
          ? [
              `import {${enumNames.map((name) => `${name}PgEnum`).join(",")}} from "${importPath(tablePath, posix.join(context.platformRoot, "database/schema/enums.ts"))}";`,
            ]
          : []),
        `export const ${name}Table = pgTable(${JSON.stringify(entity.table)},{`,
        ...columns,
        "});",
        "",
      ].join("\n"),
    });
  }
  const relations = Object.values(model.entities).filter(
    (entity) => Object.keys(entity.relations).length,
  );
  const relationPath = posix.join(directory, "relations.ts");
  files.push({
    path: relationPath,
    content: [
      'import {relations} from "drizzle-orm";',
      ...model.entityOrder.map((name) => `import {${name}Table} from "./${name}.table.js";`),
      ...relations.map(
        (entity) =>
          `export const ${entity.name}Relations = relations(${entity.name}Table,({one,many})=>({${Object.entries(
            entity.relations,
          )
            .map(
              ([name, relation]) =>
                `${JSON.stringify(name)}:${relation.type === "one-to-many" ? `many(${relation.target}Table)` : `one(${relation.target}Table,{fields:[${entity.name}Table[${JSON.stringify(relation.foreignKey)}]],references:[${relation.target}Table.id]})`}`,
            )
            .join(",")}}));`,
      ),
      "",
    ].join("\n"),
  });
  files.push({
    path: indexPath,
    content: [
      ...model.entityOrder.map((name) => `export * from "./${name}.table.js";`),
      'export * from "./relations.js";',
      "",
    ].join("\n"),
  });
  const client = posix.join(context.framework.codeRoot, context.architecture.databaseClient);
  files.push({
    path: client,
    content: [
      `import type {DrizzleDatabase as BackendDatabase} from "${importPath(client, posix.join(context.platformRoot, "database/drizzle-database.ts"))}";`,
      `export type DrizzleDatabase=Omit<BackendDatabase,"query"> & {readonly query:Pick<BackendDatabase["query"],${model.entityOrder.map((name) => JSON.stringify(`${name}Table`)).join("|")}>};`,
      "",
    ].join("\n"),
  });
  return files;
}

export function generateDrizzleAdapterFiles(
  context: BackendRenderContext,
  persistence: NonNullable<BackendRenderContext["persistence"]>,
): readonly GeneratedFile[] {
  const model = context.domainModel;

  const adapterDirectory = persistence.directories.adapter;
  const schemaDirectory = persistence.directories.schema;
  const schemaIndexPath = posix.join(schemaDirectory, "index.ts");
  const outboundPortDirectory = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.outboundPort,
  );
  const files: GeneratedFile[] = [];
  const dependencyFactoryPath = posix.join(adapterDirectory, "create-route-dependencies.ts");
  const dbClientPath =
    context.sharedDatabaseFile ?? posix.join(adapterDirectory, "drizzle-database.ts");
  const dependencyImports = [
    `import type {DrizzleDatabase} from "${importPath(dependencyFactoryPath, dbClientPath)}";`,
  ];
  const dependencyLines = ["export function createRouteDependencies(db: DrizzleDatabase) {"];
  const needsSystemClock = model.endpoints.some(
    (endpoint) =>
      endpoint.body.dynamicDefaults.length > 0 || endpoint.body.serverDefaults.length > 0,
  );
  if (needsSystemClock) {
    const clockAdapterPath = posix.join(adapterDirectory, "system-clock.adapter.ts");
    dependencyImports.push(
      `import { SystemClock } from "${importPath(dependencyFactoryPath, clockAdapterPath)}";`,
    );
    dependencyLines.push("  const clock = new SystemClock();");
  }

  // Generate one persistence adapter for each declared operation.
  for (const endpoint of model.endpoints) {
    const mainEntity = model.entities[endpoint.entity];
    const operationName = endpointTypeName(endpoint);
    const adapterPath = posix.join(adapterDirectory, `${operationName}.drizzle.query.adapter.ts`);
    const portPath = posix.join(outboundPortDirectory, `${operationName}.query.port.ts`);
    const dtoPath = posix.join(
      context.framework.codeRoot,
      context.architecture.directories.useCase,
      "dtos",
      "endpoints",
      `${operationName}.dto.ts`,
    );
    const useCasePath = posix.join(
      context.framework.codeRoot,
      context.architecture.directories.useCase,
      `${operationName}.use-case.ts`,
    );
    const adapterClass = `Drizzle${operationName}QueryAdapter`;
    const endpointUseCase = `${operationName}EndpointUseCase`;
    const adapterVariable = `${lowerFirst(operationName)}QueryAdapter`;
    dependencyImports.push(
      `import { ${adapterClass} } from "./${operationName}.drizzle.query.adapter.js";`,
    );
    dependencyImports.push(
      `import { ${operationName}UseCase as ${endpointUseCase} } from "${importPath(dependencyFactoryPath, useCasePath)}";`,
    );
    dependencyLines.push(`  const ${adapterVariable} = new ${adapterClass}(db);`);
    const endpointDynamicDefaults =
      endpoint.body.dynamicDefaults.length > 0 || endpoint.body.serverDefaults.length > 0;
    const endpointUseCaseArgs = `${adapterVariable}${endpointDynamicDefaults ? ", clock" : ""}`;
    dependencyLines.push(
      `  const ${lowerFirst(operationName)}UseCase = new ${endpointUseCase}(${endpointUseCaseArgs});`,
    );

    const decimalFields = (entityName: string) =>
      Object.entries(model.entities[entityName].fields)
        .filter(([, field]) => field.type === "number" && field.format === "decimal")
        .map(([fieldName]) => fieldName);
    const mainDecimalFields = decimalFields(endpoint.entity);
    const softDeleteCondition =
      mainEntity.softDelete === "boolean"
        ? `eq(schema.${endpoint.entity}Table.isDeleted, false)`
        : mainEntity.softDelete === "timestamp"
          ? `isNull(schema.${endpoint.entity}Table.deletedAt)`
          : undefined;

    const joinsQueryConfig: string[] = [];
    const joinResultMappings: string[] = [];
    const active = (name: string, table: string) =>
      model.entities[name].softDelete === "boolean"
        ? `eq(${table}.isDeleted,false)`
        : model.entities[name].softDelete === "timestamp"
          ? `isNull(${table}.deletedAt)`
          : "undefined";
    const innerConditions: string[] = [];
    const filterBranches = [
      `      if (filter.entity === ${JSON.stringify(endpoint.entity)}) {`,
      `        const column = (schema.${endpoint.entity}Table as any)[filter.field];`,
      "        if(column) conditions.push(compare(column,filter.operator,filter.value));",
      "      }",
    ];
    for (const join of endpoint.joins) {
      const relName = join.relation.name;
      const table = `schema.${join.entity}Table`;
      const relatedActive = active(join.entity, table);
      const selected = Object.fromEntries(
        [
          ...new Set([
            ...join.fields,
            "id",
            ...(model.entities[join.entity].softDelete === "boolean"
              ? ["isDeleted"]
              : model.entities[join.entity].softDelete === "timestamp"
                ? ["deletedAt"]
                : []),
          ]),
        ].map((name) => [name, true]),
      );
      joinsQueryConfig.push(
        `        ${relName}: { columns:${JSON.stringify(selected)}${join.cardinality === "many" ? `,where:${relatedActive},orderBy:asc(${table}.id)` : ""} },`,
      );
      const project = `{${join.fields.map((name) => `${JSON.stringify(name)}:${decimalFields(join.entity).includes(name) ? `value.${name} == null ? null : Number(value.${name})` : `value.${name}`}`).join(",")}}`;
      const visible =
        model.entities[join.entity].softDelete === "boolean"
          ? "!value.isDeleted"
          : model.entities[join.entity].softDelete === "timestamp"
            ? "value.deletedAt == null"
            : "true";
      joinResultMappings.push(
        `        ${join.entity}: ${join.cardinality === "many" ? `(row.${relName} ?? []).filter((value:any)=>${visible}).map((value:any)=>(${project}))` : `((value:any)=>value && ${visible} ? ${project} : null)(row.${relName})`},`,
      );
      const fk = join.relation.foreignKey;
      const parent =
        join.cardinality === "many"
          ? `schema.${endpoint.entity}Table.id`
          : `schema.${endpoint.entity}Table.${fk}`;
      const target = join.cardinality === "many" ? `${table}.${fk}` : `${table}.id`;
      if (join.type === "inner")
        innerConditions.push(
          `    conditions.push(inArray(${parent},this.db.select({id:${target}}).from(${table}).where(${relatedActive})));`,
        );
      filterBranches.push(
        `      else if(filter.entity === ${JSON.stringify(join.entity)}) {`,
        `        const table=${table} as any;`,
        "        if(table[filter.field]) {",
        `          const matchingRows=this.db.select({id:${target}}).from(table).where(and(compare(table[filter.field],filter.operator,filter.value),${relatedActive}));`,
        `          conditions.push(inArray(${parent},matchingRows));`,
        "        }",
        "      }",
      );
    }
    const mainEntityResult = `{${Object.keys(mainEntity.fields)
      .map(
        (name) =>
          `${JSON.stringify(name)}:${mainDecimalFields.includes(name) ? `row.${name} == null ? null : Number(row.${name})` : `row.${name}`}`,
      )
      .join(",")}}`;

    const pathConditionLines = endpoint.pathParams.flatMap((parameter) => {
      const field = parameter.field;
      if (!field || field.entity !== endpoint.entity) return [];
      return [
        `    if (input.request[${JSON.stringify(parameter.name)}] !== undefined) {`,
        `      conditions.push(eq(schema.${endpoint.entity}Table.${field.field}, input.request[${JSON.stringify(parameter.name)}]));`,
        "    }",
      ];
    });
    const requestBodyOperation =
      endpoint.body.kind === "create" || endpoint.body.kind === "update"
        ? endpoint.body.kind
        : undefined;
    const mutation = requestBodyOperation ?? (endpoint.method === "DELETE" ? "delete" : undefined);
    const writeValues = `{ ${endpoint.body.writeFields
      .map((name) => {
        const field = mainEntity.fields[name];
        const value = `input.request[${JSON.stringify(name)}]`;
        return `${JSON.stringify(name)}: ${field.type === "number" && field.format === "decimal" ? `${value} == null ? ${value} : String(${value})` : value}`;
      })
      .join(", ")} }`;
    const executeQuery =
      mutation === "create"
        ? [
            `    const rows = await this.db.insert(schema.${endpoint.entity}Table).values(${writeValues}).returning();`,
            ...(endpoint.audit
              ? [
                  "    input.captureAudit?.({before:null,after:rows,resourceIds:rows.map(row=>String(row.id))});",
                ]
              : []),
            "    return rows.map((row: any) => ({",
            `      entity: ${mainEntityResult},`,
            "      joins: {},",
            "    })) as Response;",
          ]
        : mutation === "update"
          ? [
              '    if (conditions.length === 0) throw new Error("Update endpoint requires a path or filter condition.");',
              ...(endpoint.audit
                ? [
                    `    const [beforeRows,rows]=await this.db.batch([this.db.select().from(schema.${endpoint.entity}Table).where(and(...conditions)).for("update"),this.db.update(schema.${endpoint.entity}Table).set(${writeValues}).where(and(...conditions)).returning()]);`,
                    "    input.captureAudit?.({before:beforeRows,after:rows,resourceIds:rows.map(row=>String(row.id))});",
                  ]
                : [
                    `    const rows = await this.db.update(schema.${endpoint.entity}Table).set(${writeValues}).where(and(...conditions)).returning();`,
                  ]),
              "    return rows.map((row: any) => ({",
              `      entity: ${mainEntityResult},`,
              "      joins: {},",
              "    })) as Response;",
            ]
          : mutation === "delete"
            ? [
                '    if (conditions.length === 0) throw new Error("Delete endpoint requires a path or filter condition.");',
                ...(endpoint.audit
                  ? [
                      `    const [beforeRows,rows]=await this.db.batch([this.db.select().from(schema.${endpoint.entity}Table).where(and(...conditions)).for("update"),this.db.${mainEntity.softDelete ? `update(schema.${endpoint.entity}Table).set({${mainEntity.softDelete === "boolean" ? "isDeleted:true" : "deletedAt:input.request.deletedAt"}${mainEntity.fields.updatedAt ? ",updatedAt:input.request.updatedAt" : ""}})` : `delete(schema.${endpoint.entity}Table)`}.where(and(...conditions)).returning()]);`,
                      `    input.captureAudit?.({before:beforeRows,after:${mainEntity.softDelete ? "rows" : "null"},resourceIds:rows.map(row=>String(row.id))});`,
                    ]
                  : [
                      `    const rows = await this.db.${mainEntity.softDelete ? `update(schema.${endpoint.entity}Table).set({${mainEntity.softDelete === "boolean" ? "isDeleted:true" : "deletedAt:input.request.deletedAt"}${mainEntity.fields.updatedAt ? ",updatedAt:input.request.updatedAt" : ""}})` : `delete(schema.${endpoint.entity}Table)`}.where(and(...conditions)).returning();`,
                    ]),
                "    return rows.map((row: any) => ({",
                `      entity: ${mainEntityResult},`,
                "      joins: {},",
                "    })) as Response;",
              ]
            : endpoint.pagination
              ? [
                  "    const pagination = input.pagination;",
                  `    const itemsRaw = await (this.db.query as any).${endpoint.entity}Table.findMany({`,
                  "      where: conditions.length > 0 ? and(...conditions) : undefined,",
                  "      offset: pagination.offset,",
                  "      limit: pagination.limit,",
                  `      orderBy:asc(schema.${endpoint.entity}Table.id),`,
                  "      with: {",
                  ...joinsQueryConfig,
                  "      },",
                  "    });",
                  `    const countResult = await this.db.select({ count: sql\`count(*)\` }).from(schema.${endpoint.entity}Table).where(conditions.length > 0 ? and(...conditions) : undefined);`,
                  "    const total = Number(countResult[0]?.count ?? 0);",
                  "    const items = itemsRaw.map((row: any) => ({",
                  `      entity: ${mainEntityResult},`,
                  "      joins: {",
                  ...joinResultMappings,
                  "      },",
                  "    }));",
                  "    const page = Math.floor(pagination.offset / pagination.limit) + 1;",
                  "    const pageSize = pagination.limit;",
                  "    return { items, total, page, pageSize } as Response;",
                ]
              : [
                  `    const itemsRaw = await (this.db.query as any).${endpoint.entity}Table.findMany({`,
                  "      where: conditions.length > 0 ? and(...conditions) : undefined,",
                  `      orderBy:asc(schema.${endpoint.entity}Table.id),`,
                  "      with: {",
                  ...joinsQueryConfig,
                  "      },",
                  "    });",
                  "    return itemsRaw.map((row: any) => ({",
                  `      entity: ${mainEntityResult},`,
                  "      joins: {",
                  ...joinResultMappings,
                  "      },",
                  "    })) as Response;",
                ];

    const adapterContent = [
      'import { and, asc, eq, gt, gte, ilike, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";',
      `import {ApplicationFailure} from "${importPath(adapterPath, posix.join(context.platformRoot, "application/contracts.ts"))}";`,
      `import type { ${operationName}QueryPort } from "${importPath(adapterPath, portPath)}";`,
      `import type { QueryExecution, Response } from "${importPath(adapterPath, dtoPath)}";`,
      `import type { DrizzleDatabase } from "${importPath(adapterPath, dbClientPath)}";`,
      `import * as schema from "${importPath(adapterPath, schemaIndexPath)}";`,
      "",
      "function compare(column:any,operator:string,value:any) {",
      'switch(operator){case "ne":return ne(column,value);case "in":return inArray(column,value);case "gt":return gt(column,value);case "gte":return gte(column,value);case "lt":return lt(column,value);case "lte":return lte(column,value);case "contains":return ilike(column, "%"+String(value).replace(/[\\\\%_]/g, char=>"\\\\"+char)+"%");default:return eq(column,value);}',
      "}",
      `export class Drizzle${operationName}QueryAdapter implements ${operationName}QueryPort {`,
      "  constructor(private readonly db: DrizzleDatabase) {}",
      "",
      "  async execute(input: QueryExecution): Promise<Response> {",
      "    try {",
      "    const conditions: any[] = [];",
      ...(softDeleteCondition ? [`    conditions.push(${softDeleteCondition});`] : []),
      "    for (const filter of input.filters) {",
      ...filterBranches,
      "    }",
      ...pathConditionLines,
      ...innerConditions,
      "",
      ...executeQuery,
      '    } catch(error) {const code=(error as {cause?:{code?:string};code?:string})?.cause?.code ?? (error as {code?:string})?.code;if(code === "23503" || code === "23505" || code === "23514")throw new ApplicationFailure({code:"conflict",message:"The operation conflicts with stored data."});throw error;}',
      "  }",
      "}",
      "",
    ].join("\n");

    files.push({ path: adapterPath, content: adapterContent });
    dependencyLines.push(
      `  const ${lowerFirst(operationName)}Endpoint = { useCase: ${lowerFirst(operationName)}UseCase };`,
    );
  }

  dependencyLines.push("  return {");
  dependencyLines.push("    endpoints: {");
  for (const endpoint of model.endpoints) {
    dependencyLines.push(
      `      ${JSON.stringify(lowerFirst(endpointTypeName(endpoint)))}: ${lowerFirst(endpointTypeName(endpoint))}Endpoint,`,
    );
  }
  dependencyLines.push("    },", "  };", "}", "");
  files.push({
    path: dependencyFactoryPath,
    content: [...dependencyImports, "", ...dependencyLines].join("\n"),
  });

  return files;
}

export function generateDrizzleMigrationFiles(
  persistence: NonNullable<BackendRenderContext["persistence"]>,
  identity = false,
): readonly GeneratedFile[] {
  const infrastructureDir = persistence.directories.infrastructure;
  const dbDir = posix.join(infrastructureDir, "database");
  const migratePath = posix.join(dbDir, "migrate.ts");
  const dbClientPath = posix.join(persistence.directories.adapter, "drizzle-database.ts");
  const readmePath = posix.join(dbDir, "README.md");

  const migrateContent = [
    'import { resolve } from "node:path";',
    'import { pathToFileURL,fileURLToPath } from "node:url";',
    'import { migrate } from "drizzle-orm/neon-http/migrator";',
    `import { createDrizzleDatabase } from "${importPath(migratePath, dbClientPath)}";`,
    ...(identity ? ['import {seedAuthorization} from "../authorization/seed.js";'] : []),
    "",
    "export async function runMigrations(options?:{directory?:string}): Promise<void> {",
    `  const connectionString = process.env.${persistence.connectionStringEnvironmentVariable};`,
    "  if (!connectionString) {",
    `    throw new Error("Set ${persistence.connectionStringEnvironmentVariable} before running database migrations.");`,
    "  }",
    "  const db = createDrizzleDatabase(connectionString);",
    '  console.log("Applying pending Drizzle migrations...");',
    '  await migrate(db, { migrationsFolder: options?.directory ?? fileURLToPath(new URL("../../../drizzle/",import.meta.url)) });',
    ...(identity ? ["  await seedAuthorization(db);"] : []),
    '  console.log("Migrations applied successfully.");',
    "}",
    "",
    "if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {",
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
    "pnpm db:migrate",
    "```",
    "",
    "## 3. Seed Database",
    "Seed deterministic synthetic fixtures generated according to domain contracts:",
    "```bash",
    "pnpm db:seed",
    "```",
    "",
  ].join("\n");

  return [
    { path: migratePath, content: migrateContent },
    { path: readmePath, content: readmeContent },
  ];
}

export function generateDrizzleSeedFiles(
  context: BackendRenderContext,
  persistence: NonNullable<BackendRenderContext["persistence"]>,
): readonly GeneratedFile[] {
  const model = context.domainModel;

  const infrastructureDir = persistence.directories.infrastructure;
  const dbDir = posix.join(infrastructureDir, "database");
  const seedPath = posix.join(dbDir, "seed.ts");
  const schemaIndexPath = posix.join(infrastructureDir, "database/schema/index.ts");
  const adapterDirectory = persistence.directories.adapter;
  const dbClientPath = posix.join(adapterDirectory, "drizzle-database.ts");

  const orderedEntityNames = model.entityOrder;

  const entitySeeders: string[] = [];
  for (const entityName of orderedEntityNames) {
    const entity = model.entities[entityName] as NonNullable<
      (typeof model.entities)[keyof typeof model.entities]
    >;

    const fieldAssignments: string[] = ["        id: faker.string.uuid(),"];

    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (
        fieldName === "id" ||
        Object.values(entity.relations).some(
          (relation) =>
            (relation.type === "many-to-one" || relation.type === "one-to-one") &&
            relation.foreignKey === fieldName,
        )
      )
        continue;
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
            const digits = field.format === "decimal" ? Math.min(field.scale as number, 14) : 2;
            const maximum =
              field.format === "decimal"
                ? Math.min(
                    1000,
                    10 ** ((field.precision as number) - (field.scale as number)) - 10 ** -digits,
                  )
                : 1000;
            valueExpression = `faker.number.float({ min: 0, max: ${maximum}, fractionDigits: ${digits} })`;
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
          valueExpression =
            "{ meta: faker.lorem.word(), count: faker.number.int({ min: 1, max: 10 }) }";
          break;
        case "enum": {
          const enumValues = model.enums[field.enumName];
          valueExpression = field.unique
            ? `${JSON.stringify(enumValues)}[i]`
            : `faker.helpers.arrayElement(${JSON.stringify(enumValues)})`;
          break;
        }
      }

      if (field.unique && field.type === "boolean") valueExpression = "i % 2 === 0";
      if (field.unique && field.type === "number")
        valueExpression =
          field.format === "decimal" ? `i / ${10 ** Math.min(field.scale as number, 14)}` : "i + 1";
      if (field.unique && field.type === "string")
        valueExpression = `String(i) + (${valueExpression})`;
      if (field.unique && field.type === "json") valueExpression = "{seedIndex:i}";
      if (field.defaultValue.kind === "literal" && !field.unique)
        valueExpression =
          field.type === "date" && field.defaultValue.value !== null
            ? `new Date(${JSON.stringify(field.defaultValue.value)})`
            : JSON.stringify(field.defaultValue.value);
      if (field.defaultValue.kind === "clock")
        valueExpression = 'new Date("2025-01-01T00:00:00.000Z")';
      if (
        field.type === "string" &&
        field.minLength !== undefined &&
        field.minLength > 0 &&
        field.defaultValue.kind === "absent"
      )
        valueExpression = `(${valueExpression}).padEnd(${field.minLength},"x")`;
      if (field.type === "string" && field.maxLength !== undefined && field.default !== null) {
        valueExpression = `(${valueExpression}).slice(0, ${field.maxLength})`;
      }

      if (field.required === false && field.default === undefined) {
        fieldAssignments.push(
          `        ${fieldName}: faker.datatype.boolean() ? ${valueExpression} : null,`,
        );
      } else {
        fieldAssignments.push(`        ${fieldName}: ${valueExpression},`);
      }
    }

    // Assign foreign keys from previously seeded parent entities
    for (const rel of Object.values(entity.relations)) {
      if (rel.type === "many-to-one" || rel.type === "one-to-one") {
        const foreignKeyCol = rel.foreignKey as string;
        fieldAssignments.push(
          `        ${foreignKeyCol}: ${rel.type === "one-to-one" ? `seeded.${rel.target}[i]?.id ?? null` : `seeded.${rel.target}.length > 0 ? faker.helpers.arrayElement(seeded.${rel.target}).id : null`},`,
        );
      }
    }

    const enumCapacities = Object.values(entity.fields).flatMap((field) =>
      field.unique && field.type === "enum"
        ? [(field.value.enumValues as readonly string[]).length]
        : field.unique && field.type === "boolean"
          ? [2]
          : [],
    );
    const oneToOne = Object.values(entity.relations).filter(
      (relation) => relation.type === "one-to-one" && relation.required,
    );
    const count = `Math.min(${[5, ...enumCapacities, ...oneToOne.map((relation) => `seeded.${relation.target}.length`)].join(",")})`;
    entitySeeders.push(`    // Seed ${entityName} (deterministic synthetic records)
    seeded.${entityName} = [];
    for (let i = 0; i < ${count}; i++) {
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
    'import { resolve } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    'import { faker } from "@faker-js/faker";',
    `import { createDrizzleDatabase } from "${importPath(seedPath, dbClientPath)}";`,
    `import * as schema from "${importPath(seedPath, schemaIndexPath)}";`,
    ...(context.identity ? ['import {seedAuthorization} from "../authorization/seed.js";'] : []),
    "",
    "export async function seedDatabase(options?: { seed?: number }): Promise<Record<string, any[]>> {",
    `  const connectionString = process.env.${persistence.connectionStringEnvironmentVariable};`,
    "  if (!connectionString) {",
    `    throw new Error("Set ${persistence.connectionStringEnvironmentVariable} before running database seed.");`,
    "  }",
    "  const seedValue = options?.seed ?? 42;",
    "  faker.seed(seedValue);",
    '  faker.setDefaultRefDate("2025-01-01T00:00:00.000Z");',
    "  const db = createDrizzleDatabase(connectionString);",
    ...(context.identity ? ["  await seedAuthorization(db);"] : []),
    "  const seeded: Record<string, any[]> = {};",
    "",
    ...entitySeeders,
    "",
    "  return seeded;",
    "}",
    "",
    "if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {",
    "  seedDatabase().catch((error) => {",
    '    console.error("Seeding failed:", error);',
    "    process.exit(1)",
    "  });",
    "}",
    "",
  ].join("\n");

  return [{ path: seedPath, content: seedContent }];
}

export function generateDrizzleDatabaseFile(persistence: PersistenceContext): GeneratedFile {
  const dbClientPath = posix.join(persistence.directories.adapter, "drizzle-database.ts");
  const schemaIndexPath = posix.join(
    persistence.directories.infrastructure,
    "database/schema/index.ts",
  );
  return {
    path: dbClientPath,
    content: [
      'import { neon, neonConfig } from "@neondatabase/serverless";',
      'import { drizzle } from "drizzle-orm/neon-http";',
      `import * as schema from "${importPath(dbClientPath, schemaIndexPath)}";`,
      "",
      "export type DrizzleDatabase = ReturnType<typeof createDrizzleDatabase>;",
      "",
      "export function createDrizzleDatabase(connectionString: string) {",
      "  const hostname = new URL(connectionString).hostname;",
      '  const localProxy = typeof process !== "undefined" ? process.env.NEON_HTTP_PROXY_URL : undefined;',
      "  if (localProxy) {",
      "    const endpoint = new URL(localProxy);",
      '    if (endpoint.protocol !== "http:" || endpoint.username || endpoint.password) throw new Error("NEON_HTTP_PROXY_URL must be a local HTTP endpoint without credentials.");',
      "    neonConfig.fetchEndpoint = endpoint.href;",
      "    neonConfig.poolQueryViaFetch = true;",
      '  } else if (hostname.endsWith(".localtest.me")) {',
      '    neonConfig.fetchEndpoint = "http://127.0.0.1:4444/sql";',
      "    neonConfig.poolQueryViaFetch = true;",
      "  }",
      "  const client = neon(connectionString);",
      "  return drizzle(client, { schema });",
      "}",
      "",
    ].join("\n"),
  };
}
