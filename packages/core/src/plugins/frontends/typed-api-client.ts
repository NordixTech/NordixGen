import type { FieldDefinition, NormalizedEndpointDefinition } from "../../configuration/schema.js";
import type { FrontendApiEntity, FrontendGeneratorPlugin } from "../frontend-contracts.js";
import { getFrontendOperationNames } from "../frontend-operation-names.js";

function tsType(
  field: FieldDefinition,
  enums: Readonly<Record<string, readonly string[]>>,
): string {
  switch (field.type) {
    case "string":
    case "uuid":
      return "string";
    case "date":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "unknown";
    case "enum":
      return (
        (enums[field.enumName] ?? []).map((value) => JSON.stringify(value)).join(" | ") || "string"
      );
  }
}

function entityType(
  name: string,
  entity: FrontendApiEntity,
  enums: Readonly<Record<string, readonly string[]>>,
  fields?: readonly string[],
): string {
  const entries = Object.entries(entity.fields).filter(
    ([field]) => !fields || fields.includes(field),
  );
  return `export interface ${name} {\n${entries
    .map(
      ([fieldName, field]) =>
        `  ${JSON.stringify(fieldName)}${field.required ? "" : "?"}: ${tsType(field, enums)};`,
    )
    .join("\n")}\n}`;
}

function responseType(
  endpoint: NormalizedEndpointDefinition,
  entities: Readonly<Record<string, FrontendApiEntity>>,
  enums: Readonly<Record<string, readonly string[]>>,
): string {
  const entityName = endpoint.entity;
  const joins = endpoint.joins.map((join) => {
    const many = Object.values(entities[entityName]?.relations ?? {}).some(
      (relation) =>
        relation.target === join.entity &&
        (relation.type === "one-to-many" || relation.type === "many-to-many"),
    );
    const nullable = join.type === "left" ? " | null" : "";
    const projection = `Pick<${join.entity}Response, ${join.fields.map((field) => JSON.stringify(field)).join(" | ") || "never"}>`;
    return `    ${JSON.stringify(join.entity)}: ${many ? `readonly ${projection}[]` : `${projection}${nullable}`};`;
  });
  const joinShape = joins.length ? `{\n${joins.join("\n")}\n    }` : "Record<string, never>";
  const row = `{\n    entity: ${entityName}Response;\n    joins: ${joinShape};\n  }`;
  return endpoint.pagination
    ? `{ readonly items: readonly ${row}[]; readonly total: number; readonly page: number; readonly pageSize: number }`
    : `readonly ${row}[]`;
}

function inputType(
  endpoint: NormalizedEndpointDefinition,
  enums: Readonly<Record<string, readonly string[]>>,
  name: string,
  entities: Readonly<Record<string, FrontendApiEntity>>,
): string {
  const pathParams = endpoint.pathParams.map(
    (param) => `    ${JSON.stringify(param.name)}: ${paramType(param, enums, entities)};`,
  );
  const queryParams = endpoint.queryParams.map(
    (param) =>
      `    ${JSON.stringify(param.name)}${param.required ? "" : "?"}: ${paramType(param, enums, entities)};`,
  );
  if (endpoint.pagination) {
    queryParams.push(
      `    ${JSON.stringify(endpoint.pagination.pageParam)}?: number;`,
      `    ${JSON.stringify(endpoint.pagination.pageSizeParam)}?: number;`,
    );
  }
  const body = endpoint.requestBody ? `  body: ${name}Body;` : "";
  const queryRequired = endpoint.queryParams.some((parameter) => parameter.required);
  const pathShape = pathParams.length
    ? `{\n${pathParams.join("\n")}\n  }`
    : "Record<string, never>";
  const queryShape = queryParams.length
    ? `{\n${queryParams.join("\n")}\n  }`
    : "Record<string, never>";
  return `export interface ${name}Input {\n  path${endpoint.pathParams.length ? "" : "?"}: ${pathShape};\n  query${queryRequired ? "" : "?"}: ${queryShape};\n${body}\n}`;
}

function paramType(
  param: NormalizedEndpointDefinition["queryParams"][number],
  enums: Readonly<Record<string, readonly string[]>>,
  entities: Readonly<Record<string, FrontendApiEntity>>,
): string {
  if (param.field) {
    const field = entities[param.field.entity]?.fields[param.field.field];
    if (field) {
      const type = tsType(field, enums);
      return param.operator === "in" ? `readonly (${type})[]` : type;
    }
  }
  let type = "unknown";
  if (param.type === "number") type = "number";
  if (param.type === "boolean") type = "boolean";
  if (param.type === "date" || param.type === "uuid" || param.type === "string") type = "string";
  if (param.type === "enum" && param.enumName)
    type =
      (enums[param.enumName] ?? []).map((value) => JSON.stringify(value)).join(" | ") || "string";
  return param.operator === "in" ? `readonly (${type})[]` : type;
}

function endpointPath(endpoint: NormalizedEndpointDefinition): string {
  return endpoint.path.replace(/\{([^{}]+)\}/g, "${encodeURIComponent(String(input.path?.$1))}");
}

function bodyType(
  endpoint: NormalizedEndpointDefinition,
  entities: Readonly<Record<string, FrontendApiEntity>>,
  enums: Readonly<Record<string, readonly string[]>>,
  name: string,
): string {
  if (!endpoint.requestBody) return "";
  const useCase = (
    endpoint.requestBody as { useCase?: { entity: string; operation: "create" | "update" } }
  ).useCase;
  if (useCase) {
    const entity = entities[useCase.entity];
    const generatedFields = new Set(["id", "createdAt", "updatedAt", "isDeleted", "deletedAt"]);
    const fields = Object.entries(entity?.fields ?? {})
      .filter(([field]) => !generatedFields.has(field))
      .map(([fieldName, field]) => {
        const required =
          useCase.operation === "create" && field.required && field.default === undefined;
        return `  ${JSON.stringify(fieldName)}${required ? "" : "?"}: ${tsType(field, enums)};`;
      });
    return fields.length
      ? `export interface ${name}Body {\n${fields.join("\n")}\n}`
      : `export type ${name}Body = Record<string, never>;`;
  }
  const fields = Object.entries(endpoint.requestBody).map(([name, definition]) => {
    const parameter = definition as {
      field?: { entity: string; field: string };
      required?: boolean;
    };
    if (parameter.field) {
      const field = entities[parameter.field.entity]?.fields[parameter.field.field];
      const optional =
        parameter.required === false || field?.required === false || field?.default !== undefined;
      return `  ${JSON.stringify(name)}${optional ? "?" : ""}: ${field ? tsType(field, enums) : "unknown"};`;
    }
    const field = definition as FieldDefinition;
    return `  ${JSON.stringify(name)}${field.required && field.default === undefined ? "" : "?"}: ${tsType(field, enums)};`;
  });
  return fields.length
    ? `export interface ${name}Body {\n${fields.join("\n")}\n}`
    : `export type ${name}Body = Record<string, never>;`;
}

export const typedFetchApiPlugin: FrontendGeneratorPlugin = {
  descriptor: {
    id: "typed-fetch",
    version: "1.0.0",
    role: "api-client",
    provides: ["api:typed-fetch-client", "api:backend-contracts"],
  },
  contribute(context) {
    const { api, framework } = context;
    const endpoints = api.endpoints;
    const names = getFrontendOperationNames(endpoints);
    const entities = Object.entries(api.entities);
    const typeParts = entities.map(([name, entity]) =>
      entityType(`${name}Response`, entity, api.enums),
    );
    const operationTypes = endpoints.flatMap((endpoint) => [
      inputType(endpoint, api.enums, names.get(endpoint) as string, api.entities),
      bodyType(endpoint, api.entities, api.enums, names.get(endpoint) as string),
      `export type ${names.get(endpoint)}Response = ${responseType(endpoint, api.entities, api.enums)};`,
    ]);
    const apiBaseUrl =
      framework.conventions.publicApiBaseUrlExpression ??
      '(globalThis as typeof globalThis & { __NORDIX_API_BASE_URL__?: string }).__NORDIX_API_BASE_URL__ ?? ""';
    const methodFiles = endpoints.map((endpoint) => {
      const name = names.get(endpoint) as string;
      const path = endpointPath(endpoint);
      const search = [
        "  for (const [key, value] of Object.entries(input.query ?? {}) as [string, unknown][]) {",
        "    if (value === undefined || value === null) continue;",
        "    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));",
        "    else url.searchParams.set(key, String(value));",
        "  }",
      ].join("\n");
      const body = endpoint.requestBody ? "body: JSON.stringify(input.body)," : "";
      const inputRequired =
        endpoint.pathParams.length > 0 ||
        endpoint.queryParams.some((parameter) => parameter.required) ||
        endpoint.requestBody !== undefined;
      return `export async function ${name}(input: ${name}Input${inputRequired ? "" : " = {}"}): Promise<${name}Response> {\n  const path = \`${path}\`;\n  if (typeof window === "undefined" && !API_BASE_URL) throw new Error("Configure the public API base URL for server-side requests.");\n  const url = new URL(path, API_BASE_URL || window.location.origin);\n${search}\n  return request<${name}Response>(url, { method: ${JSON.stringify(endpoint.method)}, ${body} });\n}`;
    });
    const files = [
      {
        path: `${framework.codeRoot}/lib/api/types.ts`,
        content: `${typeParts.concat(operationTypes).join("\n\n")}\n`,
      },
      {
        path: `${framework.codeRoot}/lib/api/client.ts`,
        content: `export interface ProblemDetails { type?: string; title?: string; status?: number; detail?: string; instance?: string; [extension: string]: unknown }\n\nexport class ApiError extends Error {\n  constructor(readonly status: number, readonly problem: ProblemDetails, readonly response: Response) {\n    super(problem.detail ?? problem.title ?? \`Request failed with status \${status}\`);\n    this.name = "ApiError";\n  }\n}\n\nexport const API_BASE_URL = ${apiBaseUrl};\n\nexport async function request<T>(url: URL | string, init: RequestInit = {}): Promise<T> {\n  const headers = new Headers(init.headers);\n  if (!headers.has("Accept")) headers.set("Accept", "application/json");\n  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");\n  const response = await fetch(url, { credentials: "include", ...init, headers });\n  if (!response.ok) {\n    const contentType = response.headers.get("content-type") ?? "";\n    const problem: ProblemDetails = contentType.includes("json") ? await response.json().catch(() => ({})) : { title: response.statusText };\n    throw new ApiError(response.status, problem, response);\n  }\n  if (response.status === 204) return undefined as T;\n  return response.json() as Promise<T>;\n}\n`,
      },
      {
        path: `${framework.codeRoot}/lib/api/endpoints.ts`,
        content: `import { API_BASE_URL, request } from "./client";\n${endpoints.length ? `import type { ${endpoints.flatMap((endpoint) => [`${names.get(endpoint)}Input`, `${names.get(endpoint)}Response`]).join(", ")} } from "./types";\n` : ""}\n${methodFiles.join("\n\n")}\n`,
      },
      {
        path: `${framework.codeRoot}/lib/api/index.ts`,
        content: `export * from "./client";\nexport * from "./endpoints";\nexport type * from "./types";\n`,
      },
    ];
    return files;
  },
};
