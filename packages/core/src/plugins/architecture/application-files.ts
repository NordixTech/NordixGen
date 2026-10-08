import { posix } from "node:path";
import type { FieldDefinition } from "../../configuration/schema.js";
import type { DomainModelContext, GeneratedFile, PluginContributionContext } from "../contracts.js";

function importPath(fromFile: string, targetFile: string): string {
  const path = posix.relative(posix.dirname(fromFile), targetFile.replace(/\.ts$/, ".js"));
  return path.startsWith(".") ? path : `./${path}`;
}

function fieldSchema(field: FieldDefinition, model: DomainModelContext): string {
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
  if (field.default !== undefined) return `${schema}.default(${JSON.stringify(field.default)})`;
  return field.required === false ? `${schema}.nullable().optional()` : schema;
}

function parameterSchema(
  parameter: DomainModelContext["endpoints"][number]["queryParams"][number],
  model: DomainModelContext,
): string {
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
): string[] {
  return Object.entries(fields)
    .filter(([name]) => !excluded.has(name))
    .map(([name, field]) => `  ${JSON.stringify(name)}: ${fieldSchema(field, model)},`);
}

function entityDtoFile(name: string, model: DomainModelContext): string {
  const entity = model.entities[name];
  if (!entity) throw new Error(`Domain model is missing entity "${name}".`);
  const generated = new Set([
    "id",
    ...(entity.timestamps.createdAt ? ["createdAt"] : []),
    ...(entity.timestamps.updatedAt ? ["updatedAt"] : []),
    ...(entity.softDelete ? ["deletedAt"] : []),
  ]);
  const fields = objectShape(entity.fields, model);
  const createFields = objectShape(entity.fields, model, generated);
  const filterFields = Object.entries(entity.fields)
    .filter(([name]) => !generated.has(name))
    .map(
      ([name, field]) =>
        `  ${JSON.stringify(name)}: ${fieldSchema({ ...field, required: true, default: undefined } as FieldDefinition, model)}.optional(),`,
    );
  return [
    'import { z } from "zod";',
    'import { PaginationInputSchema } from "./pagination.dto.js";',
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
    `export const List${name}InputSchema = PaginationInputSchema.extend({`,
    "  filter: z.object({",
    ...filterFields,
    "  }).partial().default({}),",
    "});",
    `export type List${name}Input = z.infer<typeof List${name}InputSchema>;`,
    "",
  ].join("\n");
}

function paginationDtoFile(): string {
  return [
    'import { z } from "zod";',
    "",
    "export const PaginationInputSchema = z.object({",
    "  page: z.number().int().positive().default(1),",
    "  pageSize: z.number().int().positive().max(100).default(20),",
    "});",
    "export type PaginationInput = z.infer<typeof PaginationInputSchema>;",
    "export interface PaginationResult<T> {",
    "  items: readonly T[];",
    "  total: number;",
    "  page: number;",
    "  pageSize: number;",
    "}",
    "",
  ].join("\n");
}

function crudUseCaseFiles(
  name: string,
  useCaseDirectory: string,
  dtoDirectory: string,
  portDirectory: string,
): GeneratedFile[] {
  const folder = posix.join(useCaseDirectory, name);
  const portPath = posix.join(portDirectory, `${name}.repository.ts`);
  const dtoPath = posix.join(dtoDirectory, `${name}.dto.ts`);
  const sharedDtoPath = posix.join(dtoDirectory, "pagination.dto.ts");
  const repositoryImport = (file: string) => importPath(file, portPath);
  const dtoImport = (file: string) => importPath(file, dtoPath);
  const sharedImport = (file: string) => importPath(file, sharedDtoPath);
  const generated: GeneratedFile[] = [];
  const definitions = [
    {
      operation: "Create",
      filename: "create",
      body: `const entity = await this.repository.create(Create${name}Schema.parse(input));\n    return ${name}ResponseSchema.parse(entity);`,
      signature: `input: unknown): Promise<${name}Response>`,
      imports: `import { Create${name}Schema, ${name}ResponseSchema } from "${dtoImport(posix.join(folder, "create.ts"))}";\nimport type { ${name}Response } from "${dtoImport(posix.join(folder, "create.ts"))}";`,
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
      body: `const { page, pageSize, filter } = List${name}InputSchema.parse(input);\n    const result = await this.repository.findPage(filter, (page - 1) * pageSize, pageSize);\n    return { ...result, items: result.items.map((entity) => ${name}ResponseSchema.parse(entity)), page, pageSize };`,
      signature: `input: unknown): Promise<PaginationResult<${name}Response>>`,
      imports: `import { List${name}InputSchema, ${name}ResponseSchema } from "${dtoImport(posix.join(folder, "list.ts"))}";\nimport type { ${name}Response } from "${dtoImport(posix.join(folder, "list.ts"))}";\nimport type { PaginationResult } from "${sharedImport(posix.join(folder, "list.ts"))}";`,
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
      `  constructor(private readonly repository: ${name}Repository) {}`,
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
  const requestBodyFields = endpoint.requestBody ? objectShape(endpoint.requestBody, model) : [];
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
    ...joinImports,
    "",
    "export const PathParamsSchema = z.object({",
    ...parameterShape(endpoint.pathParams),
    "});",
    "export const QueryParamsSchema = z.object({",
    ...parameterShape(endpoint.queryParams),
    "});",
    ...(endpoint.requestBody
      ? ["export const RequestBodySchema = z.object({", ...requestBodyFields, "});"]
      : []),
    "export const InputSchema = z.object({",
    `  path: PathParamsSchema${endpoint.pathParams.length === 0 ? ".default({})" : ""},`,
    `  query: QueryParamsSchema${endpoint.queryParams.length === 0 ? ".default({})" : ""},`,
    ...(endpoint.requestBody ? ["  body: RequestBodySchema,"] : []),
    "});",
    "export type Input = z.infer<typeof InputSchema>;",
    "export const ResponseSchema = z.array(z.object({",
    `  entity: ${endpoint.entity}ResponseSchema,`,
    "  joins: z.object({",
    ...joins,
    "  }),",
    "}));",
    "export type Response = z.infer<typeof ResponseSchema>;",
    "",
    `export const Authorization = ${JSON.stringify(
      {
        method: endpoint.method,
        path: endpoint.path,
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
    "",
    `export class ${name}UseCase {`,
    `  constructor(private readonly query: ${name}QueryPort) {}`,
    "  async execute(rawInput: unknown) {",
    "    const input = InputSchema.parse(rawInput);",
    "    return ResponseSchema.parse(await this.query.execute(input));",
    "  }",
    "}",
    "",
  ].join("\n");
  const portContent = [
    `import type { Input, Response } from "${importPath(portPath, dtoPath)}";`,
    "",
    `export interface ${name}QueryPort {`,
    "  execute(input: Input): Promise<Response>;",
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
  const files: GeneratedFile[] = [
    { path: posix.join(dtoDirectory, "pagination.dto.ts"), content: paginationDtoFile() },
  ];
  for (const name of Object.keys(model.entities).sort((left, right) => left.localeCompare(right))) {
    files.push({
      path: posix.join(dtoDirectory, `${name}.dto.ts`),
      content: entityDtoFile(name, model),
    });
    files.push(...crudUseCaseFiles(name, useCaseDirectory, dtoDirectory, portDirectory));
  }
  for (const endpoint of model.endpoints) {
    files.push(...endpointDtoFiles(endpoint, model, dtoDirectory, portDirectory, useCaseDirectory));
  }
  return files;
}
