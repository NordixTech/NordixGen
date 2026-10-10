import { posix } from "node:path";
import type { EndpointDefinition, FieldDefinition } from "../../configuration/schema.js";
import type { DomainModelContext, GeneratedFile, PluginContributionContext } from "../contracts.js";

function importPath(fromFile: string, targetFile: string): string {
  const path = posix.relative(posix.dirname(fromFile), targetFile.replace(/\.ts$/, ".js"));
  return path.startsWith(".") ? path : `./${path}`;
}

function isNowDefault(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "now"
  );
}

function fieldSchema(
  field: FieldDefinition,
  model: DomainModelContext,
  applyDefaults = true,
): string {
  let schema: string;
  switch (field.type) {
    case "string":
      schema = `z.string()${field.minLength === undefined ? "" : `.min(${field.minLength})`}${field.maxLength === undefined ? "" : `.max(${field.maxLength})`}`;
      break;
    case "number":
      schema = field.format === "integer" ? "z.number().int()" : "z.number()";
      break;
    case "boolean":
      schema = "z.boolean()";
      break;
    case "date":
      schema = "z.coerce.date()";
      break;
    case "uuid":
      schema = "z.string().uuid()";
      break;
    case "json":
      schema = "z.unknown()";
      break;
    case "enum": {
      const values = model.enums[field.enumName];
      if (!values) throw new Error(`Domain model is missing enum "${field.enumName}".`);
      schema = `z.enum([${values.map((value) => JSON.stringify(value)).join(", ")}])`;
      break;
    }
  }
  if (!applyDefaults) return field.required === false ? `${schema}.nullable().optional()` : schema;
  if (field.type === "date" && isNowDefault(field.default)) return `${schema}.optional()`;
  if (field.default !== undefined) {
    if (field.type === "date") {
      return `${schema}.default(() => new Date(${JSON.stringify(field.default)}))`;
    }
    return `${schema}.default(${JSON.stringify(field.default)})`;
  }
  return field.required === false ? `${schema}.nullable().optional()` : schema;
}

function referencedField(
  parameter: DomainModelContext["endpoints"][number]["queryParams"][number],
  model: DomainModelContext,
): FieldDefinition | undefined {
  if (!parameter.field) return undefined;
  return model.entities[parameter.field.entity]?.fields[parameter.field.field];
}

function requestBodyUseCase(body: EndpointDefinition["requestBody"]):
  | {
      entity: string;
      operation: "create" | "update";
    }
  | undefined {
  if (!body || !("useCase" in body)) return undefined;
  const reference: unknown = body.useCase;
  if (
    typeof reference !== "object" ||
    reference === null ||
    !("entity" in reference) ||
    !("operation" in reference) ||
    typeof reference.entity !== "string" ||
    (reference.operation !== "create" && reference.operation !== "update")
  ) {
    return undefined;
  }
  return { entity: reference.entity, operation: reference.operation };
}

function requestBodyFields(
  body: EndpointDefinition["requestBody"],
  model: DomainModelContext,
): Readonly<Record<string, FieldDefinition>> | undefined {
  if (!body || "useCase" in body) return undefined;
  return Object.fromEntries(
    Object.entries(body).map(([name, definition]) => {
      if ("field" in definition) {
        const source = model.entities[definition.field.entity]?.fields[definition.field.field];
        if (!source) {
          throw new Error(
            `Domain model is missing field "${definition.field.entity}.${definition.field.field}".`,
          );
        }
        return [name, { ...source, required: definition.required ?? source.required }];
      }
      return [name, definition];
    }),
  );
}

function parameterSchema(
  parameter: DomainModelContext["endpoints"][number]["queryParams"][number],
  model: DomainModelContext,
): string {
  const sourceField = referencedField(parameter, model);
  if (sourceField) {
    return `${fieldSchema({ ...sourceField, required: true, default: undefined } as FieldDefinition, model, false)}${parameter.required ? "" : ".optional()"}`;
  }
  if (parameter.type === "enum") {
    const values = parameter.enumName ? model.enums[parameter.enumName] : undefined;
    if (!values) throw new Error(`Domain model is missing enum "${parameter.enumName}".`);
    return `z.enum([${values.map((value) => JSON.stringify(value)).join(", ")}])${parameter.required ? "" : ".optional()"}`;
  }
  const field: FieldDefinition = {
    type: parameter.type,
    required: true,
    unique: false,
  } as FieldDefinition;
  return `${fieldSchema(field, model)}${parameter.required ? "" : ".optional()"}`;
}

function objectShape(
  fields: Readonly<Record<string, FieldDefinition>>,
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
  const generated = new Set([
    "id",
    ...(entity.timestamps.createdAt ? ["createdAt"] : []),
    ...(entity.timestamps.updatedAt ? ["updatedAt"] : []),
    ...(entity.softDelete === "boolean" ? ["isDeleted"] : []),
    ...(entity.softDelete === "timestamp" ? ["deletedAt"] : []),
  ]);
  const fields = objectShape(entity.fields, model, new Set(), false);
  const createFields = objectShape(entity.fields, model, generated);
  const filterFields = Object.entries(entity.fields)
    .filter(([name]) => !generated.has(name))
    .map(
      ([name, field]) =>
        `  ${JSON.stringify(name)}: ${fieldSchema({ ...field, required: true, default: undefined } as FieldDefinition, model)}.optional(),`,
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
      body: `const parsed = Create${name}Schema.parse(input);\n    const entity = await this.repository.create({ ...parsed${dynamicDefaults.map((field) => `, ${field}: parsed.${field} ?? this.clock.now()`).join("")} });\n    return ${name}ResponseSchema.parse(entity);`,
      signature: `input: unknown): Promise<${name}Response>`,
      imports: `import { Create${name}Schema, ${name}ResponseSchema } from "${dtoImport(posix.join(folder, "create.ts"))}";\nimport type { ${name}Response } from "${dtoImport(posix.join(folder, "create.ts"))}";${dynamicDefaults.length > 0 ? `\nimport type { Clock } from "${importPath(posix.join(folder, "create.ts"), posix.join(portDirectory, "clock.port.ts"))}";` : ""}`,
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
      `  constructor(private readonly repository: ${name}Repository${definition.operation === "Create" && dynamicDefaults.length > 0 ? ", private readonly clock: Clock" : ""}) {}`,
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
  if (endpoint.operationId) {
    return endpoint.operationId[0]?.toUpperCase() + endpoint.operationId.slice(1);
  }
  const words = endpoint.path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const pathName = words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join("");
  return `${endpoint.method[0]}${endpoint.method.slice(1).toLowerCase()}${pathName || "Endpoint"}`;
}

function endpointDtoFiles(
  endpoint: DomainModelContext["endpoints"][number],
  model: DomainModelContext,
  dtoDirectory: string,
  portDirectory: string,
  useCaseDirectory: string,
): GeneratedFile[] {
  const name = endpointTypeName(endpoint);
  const entity = model.entities[endpoint.entity];
  if (!entity) throw new Error(`Domain model is missing endpoint entity "${endpoint.entity}".`);
  const endpointDtoDirectory = posix.join(dtoDirectory, "endpoints");
  const dtoPath = posix.join(endpointDtoDirectory, `${name}.dto.ts`);
  const portPath = posix.join(portDirectory, `${name}.query.port.ts`);
  const useCasePath = posix.join(useCaseDirectory, `${name}.use-case.ts`);
  const joinedEntities = endpoint.joins.map((join) => {
    const joinedEntity = model.entities[join.entity];
    if (!joinedEntity) throw new Error(`Domain model is missing join entity "${join.entity}".`);
    const fields = Object.fromEntries(
      join.fields.map((fieldName) => {
        const field = joinedEntity.fields[fieldName];
        if (!field) throw new Error(`Domain model is missing field "${join.entity}.${fieldName}".`);
        return [fieldName, field];
      }),
    );
    const many = Object.values(entity.relations).some(
      (relation) =>
        relation.target === join.entity && ["one-to-many", "many-to-many"].includes(relation.type),
    );
    return { ...join, fields, many };
  });
  const parameterShape = (parameters: typeof endpoint.queryParams) =>
    parameters.map(
      (parameter) => `  ${JSON.stringify(parameter.name)}: ${parameterSchema(parameter, model)},`,
    );
  const requestBodyReference = requestBodyUseCase(endpoint.requestBody);
  const requestBodyFieldDefinitions = requestBodyFields(endpoint.requestBody, model);
  const requestBodyFieldsContent = requestBodyFieldDefinitions
    ? objectShape(requestBodyFieldDefinitions, model)
    : [];
  const requestBodySchemaName = requestBodyReference
    ? requestBodyReference.operation === "create"
      ? `Create${requestBodyReference.entity}Schema`
      : `Update${requestBodyReference.entity}Schema`
    : undefined;
  const pagination = endpoint.pagination;
  const requestBodyDynamicDefaults =
    requestBodyReference?.operation === "create"
      ? Object.entries(model.entities[requestBodyReference.entity]?.fields ?? {})
          .filter(([, field]) => field.type === "date" && isNowDefault(field.default))
          .map(([fieldName]) => fieldName)
      : Object.entries(requestBodyFieldDefinitions ?? {})
          .filter(([, field]) => field.type === "date" && isNowDefault(field.default))
          .map(([fieldName]) => fieldName);
  const paginationFields = pagination
    ? [
        `  ${JSON.stringify(pagination.pageParam)}: z.coerce.number().int().positive().default(1),`,
        `  ${JSON.stringify(pagination.pageSizeParam)}: z.coerce.number().int().positive().max(${pagination.maxPageSize}).default(${pagination.defaultPageSize}),`,
      ]
    : [];
  const filterBindings = endpoint.queryParams.filter((parameter) => parameter.field);
  const filterBindingContent = filterBindings.map(
    (parameter) =>
      `  { parameter: ${JSON.stringify(parameter.name)}, entity: ${JSON.stringify(parameter.field?.entity)}, field: ${JSON.stringify(parameter.field?.field)}, operator: ${JSON.stringify(parameter.operator ?? "eq")} },`,
  );
  const filterConditions = filterBindings.map(
    (parameter) =>
      `      ...(input.query[${JSON.stringify(parameter.name)}] === undefined ? [] : [{ entity: ${JSON.stringify(parameter.field?.entity)}, field: ${JSON.stringify(parameter.field?.field)}, operator: ${JSON.stringify(parameter.operator ?? "eq")}, value: input.query[${JSON.stringify(parameter.name)}] }]),`,
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
    return `    ${JSON.stringify(join.entity)}: ${join.many ? `z.array(${schema})` : schema}${join.type === "left" ? ".nullable()" : ""},`;
  });
  const dtoContent = [
    'import { z } from "zod";',
    `import { ${endpoint.entity}ResponseSchema } from "../${endpoint.entity}.dto.js";`,
    ...(requestBodySchemaName
      ? [`import { ${requestBodySchemaName} } from "../${requestBodyReference?.entity}.dto.js";`]
      : []),
    ...joinImports,
    "",
    "export const PathParamsSchema = z.object({",
    ...parameterShape(endpoint.pathParams),
    "});",
    "export const QueryParamsSchema = z.object({",
    ...parameterShape(endpoint.queryParams),
    ...paginationFields,
    "});",
    ...(endpoint.requestBody
      ? requestBodySchemaName
        ? [`export const RequestBodySchema = ${requestBodySchemaName};`]
        : ["export const RequestBodySchema = z.object({", ...requestBodyFieldsContent, "});"]
      : []),
    "export const InputSchema = z.object({",
    `  path: PathParamsSchema${endpoint.pathParams.length === 0 ? ".default({})" : ""},`,
    `  query: QueryParamsSchema${endpoint.queryParams.length === 0 ? ".default({})" : ""},`,
    ...(endpoint.requestBody ? ["  body: RequestBodySchema,"] : []),
    "});",
    "export type Input = z.infer<typeof InputSchema>;",
    ...(filterBindingContent.length > 0
      ? ["export const QueryFilterBindings = [", ...filterBindingContent, "] as const;"]
      : ["export const QueryFilterBindings = [] as const;"]),
    "export interface FilterCondition { entity: string; field: string; operator: string; value: unknown; }",
    "export interface QueryExecution {",
    "  request: Input;",
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
          "    const request = { ...input, body: {",
          "      ...input.body,",
          ...requestBodyDynamicDefaults.map(
            (field) => `      ${field}: input.body.${field} ?? this.clock.now(),`,
          ),
          "    } };",
        ]
      : ["    const request = input;"]),
    "    const filters: { entity: string; field: string; operator: string; value: unknown }[] = [",
    ...filterConditions,
    "    ];",
    `    const result = await this.query.execute({ request, filters${pagination ? `, pagination: { offset: (input.query[${JSON.stringify(pagination.pageParam)}] - 1) * input.query[${JSON.stringify(pagination.pageSizeParam)}], limit: input.query[${JSON.stringify(pagination.pageSizeParam)}] }` : ""} });`,
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
        Object.values(entity.fields).some(
          (field) => field.type === "date" && isNowDefault(field.default),
        ),
    ) ||
    model.endpoints.some((endpoint) => {
      if (!endpoint.requestBody || requestBodyUseCase(endpoint.requestBody)) return false;
      return Object.values(requestBodyFields(endpoint.requestBody, model) ?? {}).some(
        (field) => field.type === "date" && isNowDefault(field.default),
      );
    });
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
    if (!entity) throw new Error(`Domain model is missing entity "${name}".`);
    const dynamicDefaults = Object.entries(entity.fields)
      .filter(([, field]) => field.type === "date" && isNowDefault(field.default))
      .map(([fieldName]) => fieldName);
    files.push({
      path: posix.join(dtoDirectory, `${name}.dto.ts`),
      content: entityDtoFile(name, entity, model),
    });
    files.push(
      ...crudUseCaseFiles(name, useCaseDirectory, dtoDirectory, portDirectory, dynamicDefaults),
    );
  }
  for (const endpoint of model.endpoints) {
    files.push(...endpointDtoFiles(endpoint, model, dtoDirectory, portDirectory, useCaseDirectory));
  }
  return files;
}
