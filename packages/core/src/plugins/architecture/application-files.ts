import { posix } from "node:path";
import type { FieldDefinition } from "../../configuration/schema.js";
import type { ResolvedField, ResolvedInput } from "../../project/types.js";
import type { DomainModelContext, GeneratedFile, PluginContributionContext } from "../contracts.js";

function importPath(fromFile: string, targetFile: string): string {
  const path = posix.relative(posix.dirname(fromFile), targetFile.replace(/\.ts$/, ".js"));
  return path.startsWith(".") ? path : `./${path}`;
}

function fieldSchema(
  field: ResolvedField,
  model: DomainModelContext,
  applyDefaults = true,
  transport = false,
): string {
  let schema: string;
  switch (field.type) {
    case "string":
      schema = `z.string()${field.minLength === undefined ? "" : `.min(${field.minLength})`}${field.maxLength === undefined ? "" : `.max(${field.maxLength})`}`;
      break;
    case "number":
      schema = field.format === "integer" ? "z.number().finite().int()" : "z.number().finite()";
      break;
    case "boolean":
      schema = "z.boolean()";
      break;
    case "date":
      schema = transport
        ? "z.string().datetime({ offset: true }).transform(value => new Date(value))"
        : "z.date()";
      break;
    case "uuid":
      schema = "z.string().uuid()";
      break;
    case "json":
      schema = "z.unknown()";
      break;
    case "enum": {
      const values = field.value.enumValues as readonly string[];
      schema = `z.enum([${values.map((value) => JSON.stringify(value)).join(", ")}])`;
      break;
    }
  }
  if (field.required === false) schema += ".nullable()";
  if (!applyDefaults) return field.required === false ? `${schema}.default(null)` : schema;
  if (field.type === "date" && field.defaultValue.kind === "clock") return `${schema}.optional()`;
  if (field.default !== undefined) {
    if (field.type === "date" && field.default !== null && !transport) {
      return `${schema}.default(() => new Date(${JSON.stringify(field.default)}))`;
    }
    return `${schema}.default(${JSON.stringify(field.default)})`;
  }
  return field.required === false ? `${schema}.optional()` : schema;
}

function inputSchema(
  input: ResolvedInput,
  model: DomainModelContext,
  transport: "parameter" | "body" | false = false,
): string {
  const definition = { ...input.definition, required: true, default: undefined } as ResolvedField;
  let schema = fieldSchema(definition, model, false, Boolean(transport));
  if (transport === "parameter") {
    if (definition.type === "number")
      schema = `z.preprocess(value => typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN, ${schema})`;
    if (definition.type === "boolean")
      schema = 'z.enum(["true", "false"]).transform(value => value === "true")';
    if (definition.type === "json")
      schema =
        'z.string().transform((value, context) => { try { return JSON.parse(value) as unknown; } catch { context.addIssue({ code: "custom", message: "Expected valid JSON text" }); return z.NEVER; } })';
  }
  if (input.nullable) schema += ".nullable()";
  if (input.array)
    schema =
      transport === "parameter"
        ? `z.preprocess(value => typeof value === "string" ? [value] : value, z.array(${schema}).min(1))`
        : `z.array(${schema}).min(1)`;
  if (!input.optional) return schema;
  if (input.definition.defaultValue.kind === "literal") {
    const value = input.definition.defaultValue.value;
    return `${schema}.default(${input.definition.type === "date" && value !== null && !transport ? `() => new Date(${JSON.stringify(value)})` : JSON.stringify(value)})`;
  }
  return `${schema}.optional()`;
}

function objectShape(
  fields: Readonly<Record<string, ResolvedField>>,
  model: DomainModelContext,
  excluded: ReadonlySet<string> = new Set(),
  applyDefaults = true,
): string[] {
  return Object.entries(fields)
    .filter(([name]) => !excluded.has(name))
    .map(
      ([name, field]) => `  ${JSON.stringify(name)}: ${fieldSchema(field, model, applyDefaults)},`,
    );
}

function entityDtoFile(
  name: string,
  entity: DomainModelContext["entities"][string],
  model: DomainModelContext,
): string {
  const generated = new Set(entity.generatedFields);
  const declaredFields = entity.fields;
  const fields = objectShape(declaredFields, model, new Set(), false);
  const createFields = objectShape(declaredFields, model, generated);
  const filterFields = Object.entries(declaredFields)
    .filter(([name]) => !generated.has(name))
    .map(
      ([name, field]) =>
        `  ${JSON.stringify(name)}: ${fieldSchema({ ...field, required: true, default: undefined } as ResolvedField, model)}.optional(),`,
    );
  return [
    'import { z } from "zod";',
    "",
    `export const Create${name}Schema = z.object({`,
    ...createFields,
    "});",
    `export type Create${name}Input = z.infer<typeof Create${name}Schema>;`,
    "",
    `export const Update${name}Schema = Create${name}Schema.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one field must be updated." });`,
    `export type Update${name}Input = z.infer<typeof Update${name}Schema>;`,
    "",
    `export const ${name}ResponseSchema = z.object({`,
    ...fields,
    "});",
    `export type ${name}Response = z.infer<typeof ${name}ResponseSchema>;`,
    "",
    `export const ${name}IdSchema = z.string().uuid();`,
    `export const Update${name}RequestSchema = z.object({ id: ${name}IdSchema, changes: Update${name}Schema });`,
    `export const List${name}InputSchema = z.object({`,
    "  filter: z.object({",
    ...filterFields,
    "  }).partial().default({}),",
    "});",
    `export type List${name}Input = z.infer<typeof List${name}InputSchema>;`,
    "",
  ].join("\n");
}

function crudUseCaseFiles(
  name: string,
  useCaseDirectory: string,
  dtoDirectory: string,
  portDirectory: string,
  dynamicDefaults: readonly string[],
  timestamps: { createdAt: boolean; updatedAt: boolean },
): GeneratedFile[] {
  const folder = posix.join(useCaseDirectory, name);
  const portPath = posix.join(portDirectory, `${name}.repository.ts`);
  const dtoPath = posix.join(dtoDirectory, `${name}.dto.ts`);
  const repositoryImport = (file: string) => importPath(file, portPath);
  const dtoImport = (file: string) => importPath(file, dtoPath);
  const generated: GeneratedFile[] = [];
  const definitions = [
    {
      operation: "Create",
      filename: "create",
      body: `const parsed = Create${name}Schema.parse(input);\n    const entity = await this.repository.create({ ...parsed${dynamicDefaults.map((field) => `, ${field}: parsed.${field} ?? this.clock.now()`).join("")}${timestamps.createdAt ? ", createdAt: this.clock.now()" : ""}${timestamps.updatedAt ? ", updatedAt: this.clock.now()" : ""} });\n    return ${name}ResponseSchema.parse(entity);`,
      signature: `input: unknown): Promise<${name}Response>`,
      imports: `import { Create${name}Schema, ${name}ResponseSchema } from "${dtoImport(posix.join(folder, "create.ts"))}";\nimport type { ${name}Response } from "${dtoImport(posix.join(folder, "create.ts"))}";${dynamicDefaults.length > 0 || timestamps.createdAt || timestamps.updatedAt ? `\nimport type { Clock } from "${importPath(posix.join(folder, "create.ts"), posix.join(portDirectory, "clock.port.ts"))}";` : ""}`,
    },
    {
      operation: "Get",
      filename: "get",
      body: `const id = ${name}IdSchema.parse(input);\n    const entity = await this.repository.findById(id);\n    return entity === null ? null : ${name}ResponseSchema.parse(entity);`,
      signature: `input: unknown): Promise<${name}Response | null>`,
      imports: `import { ${name}IdSchema, ${name}ResponseSchema } from "${dtoImport(posix.join(folder, "get.ts"))}";\nimport type { ${name}Response } from "${dtoImport(posix.join(folder, "get.ts"))}";`,
    },
    {
      operation: "List",
      filename: "list",
      body: `const { filter } = List${name}InputSchema.parse(input);\n    const result = await this.repository.findMany(filter);\n    return result.map((entity) => ${name}ResponseSchema.parse(entity));`,
      signature: `input: unknown): Promise<readonly ${name}Response[]>`,
      imports: `import { List${name}InputSchema, ${name}ResponseSchema } from "${dtoImport(posix.join(folder, "list.ts"))}";\nimport type { ${name}Response } from "${dtoImport(posix.join(folder, "list.ts"))}";`,
    },
    {
      operation: "Update",
      filename: "update",
      body: `const { id, changes } = Update${name}RequestSchema.parse(input);\n    const entity = await this.repository.update(id, changes);\n    return entity === null ? null : ${name}ResponseSchema.parse(entity);`,
      signature: `input: unknown): Promise<${name}Response | null>`,
      imports: `import { Update${name}RequestSchema, ${name}ResponseSchema } from "${dtoImport(posix.join(folder, "update.ts"))}";\nimport type { ${name}Response } from "${dtoImport(posix.join(folder, "update.ts"))}";`,
    },
    {
      operation: "Delete",
      filename: "delete",
      body: `const id = ${name}IdSchema.parse(input);\n    await this.repository.delete(id);`,
      signature: "input: unknown): Promise<void>",
      imports: `import { ${name}IdSchema } from "${dtoImport(posix.join(folder, "delete.ts"))}";`,
    },
  ];
  for (const definition of definitions) {
    const filePath = posix.join(folder, `${definition.filename}-${name.toLowerCase()}.use-case.ts`);
    const imports = definition.imports;
    const body = definition.body;
    const content = [
      imports,
      `import type { ${name}Repository } from "${repositoryImport(filePath)}";`,
      "",
      `export class ${definition.operation}${name}UseCase {`,
      `  constructor(private readonly repository: ${name}Repository${definition.operation === "Create" && (dynamicDefaults.length > 0 || timestamps.createdAt || timestamps.updatedAt) ? ", private readonly clock: Clock" : ""}) {}`,
      `  async execute(${definition.signature} {`,
      `    ${body.split("\n").join("\n    ")}`,
      "  }",
      "}",
      "",
    ].join("\n");
    generated.push({ path: filePath, content });
  }
  return generated;
}

function endpointTypeName(endpoint: DomainModelContext["endpoints"][number]): string {
  return endpoint.typeName;
}

function endpointDtoFiles(
  endpoint: DomainModelContext["endpoints"][number],
  model: DomainModelContext,
  dtoDirectory: string,
  portDirectory: string,
  useCaseDirectory: string,
): GeneratedFile[] {
  const name = endpointTypeName(endpoint);
  const endpointDtoDirectory = posix.join(dtoDirectory, "endpoints");
  const dtoPath = posix.join(endpointDtoDirectory, `${name}.dto.ts`);
  const portPath = posix.join(portDirectory, `${name}.query.port.ts`);
  const useCasePath = posix.join(useCaseDirectory, `${name}.use-case.ts`);
  const joinedEntities = endpoint.joins.map((join) => ({
    ...join,
    fields: join.projection,
    many: join.cardinality === "many",
  }));
  const parameterShape = (parameters: typeof endpoint.queryParams) =>
    parameters.map(
      (parameter) =>
        `  ${JSON.stringify(parameter.name)}: ${inputSchema(parameter.input, model, "parameter")},`,
    );
  const requestBodyFieldsContent = Object.values(endpoint.body.fields).map(
    (input) => `  ${JSON.stringify(input.name)}: ${inputSchema(input, model, "body")},`,
  );
  const requestBodyDynamicDefaults = [
    ...endpoint.body.dynamicDefaults,
    ...endpoint.body.serverDefaults,
  ];
  const pagination = endpoint.pagination;
  const paginationFields = pagination
    ? [
        `  ${JSON.stringify(pagination.pageParam)}: z.coerce.number().int().positive().default(1),`,
        `  ${JSON.stringify(pagination.pageSizeParam)}: z.coerce.number().int().positive().max(${pagination.maxPageSize}).default(${pagination.defaultPageSize}),`,
      ]
    : [];
  const filterBindings = endpoint.queryParams.flatMap((parameter) =>
    parameter.input.binding
      ? [
          {
            parameter: parameter.name,
            entity: parameter.input.binding.entity,
            field: parameter.input.binding.field,
            operator: parameter.operator,
          },
        ]
      : [],
  );
  const filterBindingContent = filterBindings.map((binding) => `  ${JSON.stringify(binding)},`);
  const filterConditions = filterBindings.map(
    (binding) =>
      `      ...(input[${JSON.stringify(binding.parameter)}] === undefined ? [] : [{ entity: ${JSON.stringify(binding.entity)}, field: ${JSON.stringify(binding.field)}, operator: ${JSON.stringify(binding.operator)}, value: input[${JSON.stringify(binding.parameter)}] }]),`,
  );
  const joinImports = joinedEntities.map(
    (join) => `import { ${join.entity}ResponseSchema } from "../${join.entity}.dto.js";`,
  );
  const joins = joinedEntities.map((join) => {
    const schema = `z.object({ ${Object.keys(join.fields)
      .map(
        (fieldName) =>
          `${JSON.stringify(fieldName)}: ${join.entity}ResponseSchema.shape[${JSON.stringify(fieldName)}]`,
      )
      .join(", ")} })`;
    return `    ${JSON.stringify(join.entity)}: ${join.many ? `z.array(${schema})` : schema}${join.nullable ? ".nullable()" : ""},`;
  });
  const dtoContent = [
    'import { z } from "zod";',
    `import { ${endpoint.entity}ResponseSchema } from "../${endpoint.entity}.dto.js";`,
    ...joinImports,
    "",
    "export const PathParamsSchema = z.object({",
    ...parameterShape(endpoint.pathParams),
    "}).strict();",
    "export const QueryParamsSchema = z.object({",
    ...parameterShape(endpoint.queryParams),
    ...paginationFields,
    "}).strict();",
    ...(endpoint.body.kind !== "none"
      ? [
          "export const RequestBodySchema = z.object({",
          ...requestBodyFieldsContent,
          `}).strict()${endpoint.body.kind === "update" ? '.refine(value => Object.keys(value).length > 0, { message: "At least one field must be updated." })' : ""};`,
        ]
      : []),
    "export const InputSchema = z.object({",
    ...Object.values(endpoint.input).map(
      (input) =>
        `  ${JSON.stringify(input.name)}: ${input.from === "pagination" ? `z.number().int().positive()${input.name === pagination?.pageSizeParam ? `.max(${pagination.maxPageSize})` : ""}.default(${input.definition.default})` : inputSchema(input, model)},`,
    ),
    `}).strict()${endpoint.body.kind === "update" ? `.refine(value => ${JSON.stringify(Object.keys(endpoint.body.fields))}.some(key => Object.hasOwn(value, key)), { message: "At least one field must be updated." })` : ""};`,
    "export type Input = z.infer<typeof InputSchema>;",
    ...(filterBindingContent.length > 0
      ? ["export const QueryFilterBindings = [", ...filterBindingContent, "] as const;"]
      : ["export const QueryFilterBindings = [] as const;"]),
    "export interface FilterCondition { entity: string; field: string; operator: string; value: unknown; }",
    "export interface QueryExecution {",
    `  request: Input${requestBodyDynamicDefaults.length ? ` & { ${requestBodyDynamicDefaults.map((name) => `${JSON.stringify(name)}: Date${endpoint.body.fields[name]?.nullable ? " | null" : ""}`).join("; ")} }` : ""};`,
    "  filters: readonly FilterCondition[];",
    ...(pagination ? ["  pagination: { offset: number; limit: number };"] : []),
    "}",
    ...(pagination
      ? [
          "export const ResponseSchema = z.object({",
          "  items: z.array(z.object({",
          `    entity: ${endpoint.entity}ResponseSchema,`,
          "    joins: z.object({",
          ...joins,
          "    }),",
          "  })),",
          "  total: z.number().int().nonnegative(),",
          "  page: z.number().int().positive(),",
          "  pageSize: z.number().int().positive(),",
          "});",
        ]
      : [
          "export const ResponseSchema = z.array(z.object({",
          `  entity: ${endpoint.entity}ResponseSchema,`,
          "  joins: z.object({",
          ...joins,
          "  }),",
          "}));",
        ]),
    "export type Response = z.infer<typeof ResponseSchema>;",
    "",
    `export const Authorization = ${JSON.stringify(
      {
        method: endpoint.method,
        path: endpoint.path,
        operationId: name,
        authRequired: endpoint.authRequired,
        roles: endpoint.roles,
        permissions: endpoint.permissions,
      },
      null,
      2,
    )} as const;`,
    "",
  ].join("\n");
  const useCaseContent = [
    `import { InputSchema, ResponseSchema } from "${importPath(useCasePath, dtoPath)}";`,
    `import type { ${name}QueryPort } from "${importPath(useCasePath, portPath)}";`,
    ...(requestBodyDynamicDefaults.length > 0
      ? [
          `import type { Clock } from "${importPath(useCasePath, posix.join(portDirectory, "clock.port.ts"))}";`,
        ]
      : []),
    "",
    `export class ${name}UseCase {`,
    `  constructor(private readonly query: ${name}QueryPort${requestBodyDynamicDefaults.length > 0 ? ", private readonly clock: Clock" : ""}) {}`,
    "  async execute(rawInput: unknown) {",
    "    const input = InputSchema.parse(rawInput);",
    ...(requestBodyDynamicDefaults.length > 0
      ? [
          "    const request = {",
          "      ...input,",
          ...requestBodyDynamicDefaults.map(
            (field) =>
              `      ${field}: ${endpoint.body.serverDefaults.includes(field) ? "this.clock.now()" : `input.${field} === undefined ? this.clock.now() : input.${field}`},`,
          ),
          "    };",
        ]
      : ["    const request = input;"]),
    "    const filters: { entity: string; field: string; operator: string; value: unknown }[] = [",
    ...filterConditions,
    "    ];",
    `    const result = await this.query.execute({ request, filters${pagination ? `, pagination: { offset: (input[${JSON.stringify(pagination.pageParam)}] - 1) * input[${JSON.stringify(pagination.pageSizeParam)}], limit: input[${JSON.stringify(pagination.pageSizeParam)}] }` : ""} });`,
    "    return ResponseSchema.parse(result);",
    "  }",
    "}",
    "",
  ].join("\n");
  const portContent = [
    `import type { QueryExecution, Response } from "${importPath(portPath, dtoPath)}";`,
    "",
    `export interface ${name}QueryPort {`,
    "  execute(input: QueryExecution): Promise<Response>;",
    "}",
    "",
  ].join("\n");
  return [
    { path: dtoPath, content: dtoContent },
    { path: useCasePath, content: useCaseContent },
    { path: portPath, content: portContent },
  ];
}

/** Generates Zod DTOs and framework-neutral application use cases for one backend. */
export function generateApplicationFiles(
  context: PluginContributionContext,
): readonly GeneratedFile[] {
  const model = context.domainModel;
  if (!model) return [];
  const codeRoot = context.framework.codeRoot;
  const useCaseDirectory = posix.join(codeRoot, context.architecture.directories.useCase);
  const dtoDirectory = posix.join(codeRoot, context.architecture.directories.useCase, "dtos");
  const portDirectory = posix.join(codeRoot, context.architecture.directories.outboundPort);
  const adapterDirectory = posix.join(codeRoot, context.architecture.directories.adapter);
  const hasDynamicDefaults =
    Object.values(model.entities).some(
      (entity) =>
        entity &&
        (entity.timestamps.createdAt ||
          entity.timestamps.updatedAt ||
          Object.values(entity.fields).some(
            (field) => field.type === "date" && field.defaultValue.kind === "clock",
          )),
    ) ||
    model.endpoints.some(
      (endpoint) =>
        endpoint.body.dynamicDefaults.length > 0 || endpoint.body.serverDefaults.length > 0,
    );
  const files: GeneratedFile[] = [];
  if (hasDynamicDefaults) {
    const clockPortPath = posix.join(portDirectory, "clock.port.ts");
    const clockAdapterPath = posix.join(adapterDirectory, "system-clock.adapter.ts");
    files.push({
      path: clockPortPath,
      content: ["export interface Clock {", "  now(): Date;", "}", ""].join("\n"),
    });
    files.push({
      path: clockAdapterPath,
      content: [
        `import type { Clock } from "${importPath(clockAdapterPath, clockPortPath)}";`,
        "",
        "export class SystemClock implements Clock {",
        "  now(): Date {",
        "    return new Date();",
        "  }",
        "}",
        "",
      ].join("\n"),
    });
  }
  for (const name of Object.keys(model.entities).sort((left, right) => left.localeCompare(right))) {
    const entity = model.entities[name];
    const dynamicDefaults = Object.entries(entity.fields)
      .filter(([, field]) => field.type === "date" && field.defaultValue.kind === "clock")
      .map(([fieldName]) => fieldName);
    files.push({
      path: posix.join(dtoDirectory, `${name}.dto.ts`),
      content: entityDtoFile(name, entity, model),
    });
    files.push(
      ...crudUseCaseFiles(name, useCaseDirectory, dtoDirectory, portDirectory, dynamicDefaults, {
        createdAt: entity.timestamps.createdAt,
        updatedAt: entity.timestamps.updatedAt,
      }),
    );
  }
  for (const endpoint of model.endpoints) {
    files.push(...endpointDtoFiles(endpoint, model, dtoDirectory, portDirectory, useCaseDirectory));
  }
  return files;
}
