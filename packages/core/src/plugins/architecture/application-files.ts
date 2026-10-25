import { posix } from "node:path";
import type { ResolvedField, ResolvedInput } from "../../project/types.js";
import type { BackendRenderContext, DomainModelContext, GeneratedFile } from "../contracts.js";

function importPath(fromFile: string, targetFile: string): string {
  const path = posix.relative(posix.dirname(fromFile), targetFile.replace(/\.ts$/, ".js"));
  return path.startsWith(".") ? path : `./${path}`;
}

const JSON_SCHEMA = [
  "type JsonValue=string|number|boolean|null|JsonValue[]|{[key:string]:JsonValue};",
  "const JsonValueSchema:z.ZodType<JsonValue>=z.lazy(()=>z.union([z.string(),z.number().finite(),z.boolean(),z.null(),z.array(JsonValueSchema),z.record(z.string(),JsonValueSchema)]));",
];

function fieldSchema(field: ResolvedField, transport = false): string {
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
      // Unlike z.unknown(), this schema excludes undefined in both runtime validation
      // and inference, so required JSON properties stay required.
      schema =
        'JsonValueSchema.refine(value=>value!==null,{message:"Expected a non-null JSON value."})';
      break;
    case "enum": {
      const values = field.value.enumValues as readonly string[];
      schema = `z.enum([${values.map((value) => JSON.stringify(value)).join(", ")}])`;
      break;
    }
  }
  if (field.required === false) schema += ".nullable()";
  return field.required === false ? `${schema}.default(null)` : schema;
}

function inputSchema(
  input: ResolvedInput,
  transport: "parameter" | "body" | false = false,
): string {
  const definition = { ...input.definition, required: true, default: undefined } as ResolvedField;
  let schema = fieldSchema(definition, Boolean(transport));
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
    if (transport && input.definition.type === "date" && value !== null)
      return `${schema}.prefault(${JSON.stringify(value)})`;
    return `${schema}.default(${input.definition.type === "date" && value !== null && !transport ? `() => new Date(${JSON.stringify(value)})` : JSON.stringify(value)})`;
  }
  return `${schema}.optional()`;
}

function entityResponseFile(name: string, entity: DomainModelContext["entities"][string]): string {
  return [
    'import { z } from "zod";',
    ...JSON_SCHEMA,
    `export const ${name}ResponseSchema = z.object({`,
    ...Object.entries(entity.fields).map(
      ([name, field]) => `  ${JSON.stringify(name)}: ${fieldSchema(field)},`,
    ),
    "});",
    `export type ${name}Response = z.infer<typeof ${name}ResponseSchema>;`,
    "",
  ].join("\n");
}

function endpointTypeName(endpoint: DomainModelContext["endpoints"][number]): string {
  return endpoint.typeName;
}

function endpointDtoFiles(
  endpoint: DomainModelContext["endpoints"][number],
  dtoDirectory: string,
  portDirectory: string,
  useCaseDirectory: string,
  context: BackendRenderContext,
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
        `  ${JSON.stringify(parameter.name)}: ${inputSchema(parameter.input, "parameter")},`,
    );
  const requestBodyFieldsContent = Object.values(endpoint.body.fields).map(
    (input) => `  ${JSON.stringify(input.name)}: ${inputSchema(input, "body")},`,
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
    ...JSON_SCHEMA,
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
        `  ${JSON.stringify(input.name)}: ${input.from === "pagination" ? `z.number().int().positive()${input.name === pagination?.pageSizeParam ? `.max(${pagination.maxPageSize})` : ""}.default(${input.definition.default})` : inputSchema(input)},`,
    ),
    `}).strict()${endpoint.body.kind === "update" ? `.refine(value => ${JSON.stringify(Object.keys(endpoint.body.fields))}.some(key => Object.hasOwn(value, key)), { message: "At least one field must be updated." })` : ""};`,
    "export type Input = z.infer<typeof InputSchema>;",
    ...(filterBindingContent.length > 0
      ? ["export const QueryFilterBindings = [", ...filterBindingContent, "] as const;"]
      : ["export const QueryFilterBindings = [] as const;"]),
    "export interface FilterCondition { entity: string; field: string; operator: string; value: unknown; }",
    "export interface QueryExecution {",
    "  captureAudit?:(change:{before:unknown;after:unknown;resourceIds:readonly string[]})=>void;",
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
  const inboundPath = posix.join(
    context.framework.codeRoot,
    context.architecture.inboundPort,
    `${name}.port.ts`,
  );
  const explicitPort = context.domainModel.modules[0]?.architecture !== "clean";
  const useCaseContent = [
    ...(explicitPort
      ? [`import type {${name}Port} from "${importPath(useCasePath, inboundPath)}";`]
      : []),
    ...(endpoint.audit
      ? [
          `import type {OperationContext} from "${importPath(useCasePath, posix.join(context.platformRoot, "application/contracts.ts"))}";`,
        ]
      : []),
    `import { InputSchema, ResponseSchema } from "${importPath(useCasePath, dtoPath)}";`,
    `import type { ${name}QueryPort } from "${importPath(useCasePath, portPath)}";`,
    ...(requestBodyDynamicDefaults.length > 0
      ? [
          `import type { Clock } from "${importPath(useCasePath, posix.join(portDirectory, "clock.port.ts"))}";`,
        ]
      : []),
    "",
    `export class ${name}UseCase${explicitPort ? ` implements ${name}Port` : ""} {`,
    `  constructor(private readonly query: ${name}QueryPort${requestBodyDynamicDefaults.length > 0 ? ", private readonly clock: Clock" : ""}) {}`,
    `  async execute(rawInput: unknown${endpoint.audit ? ",context?:OperationContext" : ""}) {`,
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
    `    const result = await this.query.execute({ request, filters${endpoint.audit ? `,captureAudit:change=>{try{context?.captureAudit?.({operationId:${JSON.stringify(endpoint.operationId)},...change});}catch{console.error("Audit capture failed.");}}` : ""}${pagination ? `, pagination: { offset: (input[${JSON.stringify(pagination.pageParam)}] - 1) * input[${JSON.stringify(pagination.pageSizeParam)}], limit: input[${JSON.stringify(pagination.pageSizeParam)}] }` : ""} });`,
    ...(endpoint.audit && (endpoint.action === "query" || endpoint.action === "custom")
      ? [
          `    try{context?.captureAudit?.({operationId:${JSON.stringify(endpoint.operationId)},before:null,after:result,resourceIds:[]});}catch{console.error("Audit capture failed.");}`,
        ]
      : []),
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
    ...(explicitPort
      ? [
          {
            path: inboundPath,
            content: [
              `import type {Response} from "${importPath(inboundPath, dtoPath)}";`,
              `import type {OperationContext} from "${importPath(inboundPath, posix.join(context.platformRoot, "application/contracts.ts"))}";`,
              `export interface ${name}Port {execute(input:unknown,context?:OperationContext):Promise<Response>;}`,
              "",
            ].join("\n"),
          },
        ]
      : []),
  ];
}

/** Generates Zod DTOs and framework-neutral application use cases for one backend. */
export function generateApplicationFiles(context: BackendRenderContext): readonly GeneratedFile[] {
  const model = context.domainModel;
  const codeRoot = context.framework.codeRoot;
  const useCaseDirectory = posix.join(codeRoot, context.architecture.directories.useCase);
  const dtoDirectory = posix.join(codeRoot, context.architecture.directories.useCase, "dtos");
  const portDirectory = posix.join(codeRoot, context.architecture.directories.outboundPort);
  const adapterDirectory = posix.join(codeRoot, context.architecture.directories.adapter);
  const hasDynamicDefaults = model.endpoints.some(
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
  const responseEntities = new Set(
    model.endpoints.flatMap((endpoint) => [
      endpoint.entity,
      ...endpoint.joins.map((join) => join.entity),
    ]),
  );
  for (const name of [...responseEntities].sort()) {
    files.push({
      path: posix.join(dtoDirectory, `${name}.dto.ts`),
      content: entityResponseFile(name, model.entities[name]),
    });
  }
  for (const endpoint of model.endpoints) {
    files.push(
      ...endpointDtoFiles(endpoint, dtoDirectory, portDirectory, useCaseDirectory, context),
    );
  }
  return files;
}
