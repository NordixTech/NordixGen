import { backendBaseEnvironment } from "../../generation/frontend-access.js";
import type {
  TransportField,
  TransportInput,
  TransportOperation,
  TransportParameter,
} from "../../project/types.js";
import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
import { apiExplorerSource } from "./api-explorer.js";

function valueType(field: TransportField, nullable = field.nullable): string {
  return field.value.transportType + (nullable ? " | null" : "");
}
function inputValue(input: TransportInput): string {
  const type = valueType(input.definition, input.nullable);
  return input.array ? `readonly (${type})[]` : type;
}
function entityType(name: string, fields: Readonly<Record<string, TransportField>>): string {
  return `export interface ${name} {\n${Object.entries(fields)
    .map(([name, field]) => `  ${JSON.stringify(name)}: ${valueType(field)};`)
    .join("\n")}\n}`;
}
function responseType(endpoint: TransportOperation): string {
  const joins = endpoint.response.joins.map((join) => {
    const projection = `{ ${Object.entries(join.projection)
      .map(([name, field]) => `readonly ${JSON.stringify(name)}: ${valueType(field)}`)
      .join("; ")} }`;
    return `    ${JSON.stringify(join.entity)}: ${join.cardinality === "many" ? `readonly ${projection}[]` : projection + (join.nullable ? " | null" : "")};`;
  });
  const row = `{ entity: ${endpoint.entity}Response; joins: ${joins.length ? `{\n${joins.join("\n")}\n}` : "Record<string, never>"} }`;
  return endpoint.response.kind === "page"
    ? `{ readonly items: readonly ${row}[]; readonly total: number; readonly page: number; readonly pageSize: number }`
    : `readonly ${row}[]`;
}
function inputType(endpoint: TransportOperation, name: string): string {
  const properties = (inputs: readonly TransportInput[]) =>
    inputs.length
      ? `{\n${inputs.map((input) => `    ${JSON.stringify(input.name)}${input.optional ? "?" : ""}: ${inputValue(input)};`).join("\n")}\n  }`
      : "Record<string, never>";
  const path = endpoint.pathParams.map((p) => p.input);
  const query = Object.values(endpoint.input).filter(
    (input) => input.from === "query" || input.from === "pagination",
  );
  return `export interface ${name}Input {\n  path${path.length ? "" : "?"}: ${properties(path)};\n  query${query.some((input) => !input.optional) ? "" : "?"}: ${properties(query)};\n${endpoint.body.kind === "none" ? "" : `  body: ${name}Body;\n`}}`;
}
function endpointPath(endpoint: TransportOperation): string {
  return endpoint.path.replace(/\{([^{}]+)\}/g, "${encodeURIComponent(String(input.path?.$1))}");
}
function bodyType(endpoint: TransportOperation, name: string): string {
  if (endpoint.body.kind === "none") return "";
  const fields = Object.values(endpoint.body.fields).map(
    (input) => `  ${JSON.stringify(input.name)}${input.optional ? "?" : ""}: ${inputValue(input)};`,
  );
  return fields.length
    ? `export interface ${name}Body {\n${fields.join("\n")}\n}`
    : `export type ${name}Body = Record<string, never>;`;
}
function exampleFieldValue(field: TransportField): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "enum":
      return (field.value.enumValues as readonly string[])[0];
    case "json":
      return {};
    case "date":
      return "2025-01-01T00:00:00.000Z";
    case "uuid":
      return "00000000-0000-4000-8000-000000000000";
    default:
      return "Example".padEnd(field.minLength ?? 0, "x").slice(0, field.maxLength);
  }
}
function bodyExample(endpoint: TransportOperation): Record<string, unknown> {
  return Object.fromEntries(
    Object.values(endpoint.body.fields)
      .filter((input) => input.definition.defaultValue.kind !== "clock")
      .map((input) => [input.name, exampleFieldValue(input.definition)]),
  );
}
function explorerField(field: TransportField) {
  return {
    type: field.type,
    enumValues: field.value.enumValues,
    constraints: [
      ...(field.type === "string" && field.minLength !== undefined
        ? [`Min. length: ${field.minLength}`]
        : []),
      ...(field.type === "string" && field.maxLength !== undefined
        ? [`Max. length: ${field.maxLength}`]
        : []),
      ...(field.type === "number" && field.format
        ? [
            field.format === "decimal"
              ? `Decimal (${field.precision}, ${field.scale})`
              : field.format,
          ]
        : []),
    ],
  };
}
function explorerParameter(parameter: TransportParameter) {
  return {
    name: parameter.name,
    ...explorerField(parameter.definition),
    required: parameter.required,
    nullable: parameter.input.nullable,
    array: parameter.input.array,
    ...(parameter.operator ? { operator: parameter.operator } : {}),
  };
}

export function generateApiClientFiles(context: FrontendRenderContext): readonly GeneratedFile[] {
  const { api, framework } = context;
  const endpoints = api.endpoints;
  const names = new Map(endpoints.map((endpoint) => [endpoint, api.operationNames[endpoint.id]]));
  const entities = Object.entries(api.entities);
  const typeParts = entities.map(([name, entity]) => entityType(`${name}Response`, entity.fields));
  const operationTypes = endpoints.flatMap((endpoint) => [
    inputType(endpoint, names.get(endpoint) as string),
    bodyType(endpoint, names.get(endpoint) as string),
    `export type ${names.get(endpoint)}Response = ${responseType(endpoint)};`,
  ]);
  const backendUrls = context.frontend.connections
    .map(
      (name) =>
        `${JSON.stringify(name)}:process.env.${backendBaseEnvironment(name)}${context.frontend.connections.length === 1 ? ' ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? ""' : ' ?? ""'}`,
    )
    .join(",");
  const methodFiles = endpoints.map((endpoint) => {
    const name = names.get(endpoint) as string;
    const path = endpointPath(endpoint);
    const search = [
      "  for (const [key, value] of Object.entries(input.query ?? {}) as [string, unknown][]) {",
      "    if (value === undefined) continue;",
      `    const encode=(item:unknown)=>(${JSON.stringify(endpoint.queryParams.filter((parameter) => parameter.definition.type === "json").map((parameter) => parameter.name))} as readonly string[]).includes(key)?JSON.stringify(item):String(item);`,
      "    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, encode(item));",
      "    else url.searchParams.set(key, encode(value));",
      "  }",
    ].join("\n");
    const body = endpoint.body.kind !== "none" ? "body: JSON.stringify(input.body)," : "";
    const inputRequired =
      endpoint.pathParams.length > 0 ||
      endpoint.queryParams.some((parameter) => parameter.required) ||
      endpoint.body.kind !== "none";
    return `export async function ${name}(input: ${name}Input${inputRequired ? "" : " = {}"}, options:{signal?:AbortSignal}={}): Promise<${name}Response> {\n  const path = \`${path}\`;\n  const base=backendBaseUrl(${JSON.stringify(endpoint.backend)});\n  const url = new URL(path, base);\n${search}\n  return request<${name}Response>(url, { method: ${JSON.stringify(endpoint.method)}, ${body} signal:options.signal });\n}`;
  });
  const explorerMetadata = endpoints.map((endpoint) => ({
    name: names.get(endpoint),
    id: endpoint.id,
    backend: endpoint.backend,
    moduleId: endpoint.moduleId,
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary ?? endpoint.operationId,
    entity: endpoint.entity,
    authRequired: endpoint.authRequired,
    roles: endpoint.roles,
    permissions: endpoint.permissions,
    pathParams: endpoint.pathParams.map((parameter) => explorerParameter(parameter)),
    queryParams: endpoint.queryParams.map((parameter) => explorerParameter(parameter)),
    requestBody:
      endpoint.body.kind === "none"
        ? null
        : Object.fromEntries(
            Object.values(endpoint.body.fields).map((input) => [
              input.name,
              {
                ...explorerField(input.definition),
                required: !input.optional,
                nullable: input.nullable,
                array: input.array,
              },
            ]),
          ),
    bodyExample: bodyExample(endpoint),
    pagination: endpoint.pagination
      ? {
          pageParam: endpoint.pagination.pageParam,
          pageSizeParam: endpoint.pagination.pageSizeParam,
          defaultPageSize: endpoint.pagination.defaultPageSize,
          maxPageSize: endpoint.pagination.maxPageSize,
        }
      : null,
  }));
  const files = [
    {
      path: `${framework.codeRoot}/lib/api/types.ts`,
      content: `${typeParts.concat(operationTypes).join("\n\n")}\n`,
    },
    {
      path: `${framework.codeRoot}/lib/api/client.ts`,
      content: `export interface ProblemDetails { type?: string; title?: string; status?: number; detail?: string; instance?: string; [extension: string]: unknown }\n\nexport class ApiError extends Error {\n  constructor(readonly status: number, readonly problem: ProblemDetails, readonly response: Response) {\n    super(problem.detail ?? problem.title ?? \`Request failed with status \${status}\`);\n    this.name = "ApiError";\n  }\n}\n\nconst backendUrls:Readonly<Record<string,string>>={${backendUrls}};\nexport function backendBaseUrl(backend:string):string { const base=backendUrls[backend];if(base)return base;${context.frontend.connections.length === 1 ? 'if(typeof window!=="undefined")return window.location.origin;' : ""}throw new Error("Configure the public API base URL for backend "+backend+".");}\n\nexport async function request<T>(url: URL | string, init: RequestInit = {}): Promise<T> {\n  const headers = new Headers(init.headers);\n  if (!headers.has("Accept")) headers.set("Accept", "application/json");\n  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");\n  const response = await fetch(url, { credentials: "include", ...init, headers });\n  if (!response.ok) {\n    const contentType = response.headers.get("content-type") ?? "";\n    const problem: ProblemDetails = contentType.includes("json") ? await response.json().catch(() => ({})) : { title: response.statusText };\n    throw new ApiError(response.status, problem, response);\n  }\n  if (response.status === 204) return undefined as T;\n  return response.json() as Promise<T>;\n}\n`,
    },
    {
      path: `${framework.codeRoot}/lib/api/endpoints.ts`,
      content: `import { backendBaseUrl, request } from "./client";\n${endpoints.length ? `import type { ${endpoints.flatMap((endpoint) => [`${names.get(endpoint)}Input`, `${names.get(endpoint)}Response`]).join(", ")} } from "./types";\n` : ""}\n${methodFiles.join("\n\n")}\n`,
    },
    {
      path: `${framework.codeRoot}/lib/api/index.ts`,
      content: `export * from "./client";\nexport * from "./endpoints";\nexport type * from "./types";\n`,
    },
    ...(endpoints.length > 0
      ? [
          {
            path: `${framework.codeRoot}/components/api/api-explorer.tsx`,
            content: apiExplorerSource(
              JSON.stringify(explorerMetadata, null, 2),
              endpoints
                .map((endpoint) => {
                  const name = names.get(endpoint) as string;
                  return `  ${JSON.stringify(name)}: (input: unknown) => apiEndpoints.${name}(input as apiTypes.${name}Input),`;
                })
                .join("\n"),
              Boolean(api.authentication),
            ),
          },
        ]
      : []),
    ...(endpoints.length > 0
      ? [
          {
            path: `${framework.codeRoot}/app/api-explorer/page.tsx`,
            content: `import { ApiExplorer } from "@/components/api/api-explorer";\n\nexport const metadata = { title: "API Explorer" };\nexport default function ApiExplorerPage() { return <ApiExplorer />; }\n`,
          },
        ]
      : []),
  ];
  return files;
}
