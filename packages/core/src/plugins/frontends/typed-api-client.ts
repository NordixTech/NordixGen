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
): string {
  const entries = Object.entries(entity.fields);
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

function exampleFieldValue(
  field: FieldDefinition,
  enums: Readonly<Record<string, readonly string[]>>,
): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "enum":
      return enums[field.enumName ?? ""]?.[0] ?? "";
    case "json":
      return {};
    default:
      return "";
  }
}

function bodyExample(
  endpoint: NormalizedEndpointDefinition,
  entities: Readonly<Record<string, FrontendApiEntity>>,
  enums: Readonly<Record<string, readonly string[]>>,
): Record<string, unknown> {
  if (!endpoint.requestBody) return {};
  const useCase = (endpoint.requestBody as { useCase?: { entity: string } }).useCase;
  if (useCase) {
    const generatedFields = new Set(["id", "createdAt", "updatedAt", "isDeleted", "deletedAt"]);
    return Object.fromEntries(
      Object.entries(entities[useCase.entity]?.fields ?? {})
        .filter(([name]) => !generatedFields.has(name))
        .map(([name, field]) => [name, exampleFieldValue(field, enums)]),
    );
  }
  return Object.fromEntries(
    Object.entries(endpoint.requestBody).map(([name, definition]) => {
      const ref = (definition as { field?: { entity: string; field: string } }).field;
      const field = ref ? entities[ref.entity]?.fields[ref.field] : (definition as FieldDefinition);
      return [name, field ? exampleFieldValue(field, enums) : ""];
    }),
  );
}

function explorerParameter(
  parameter: NormalizedEndpointDefinition["queryParams"][number],
  entities: Readonly<Record<string, FrontendApiEntity>>,
  enums: Readonly<Record<string, readonly string[]>>,
) {
  const referencedField = parameter.field
    ? entities[parameter.field.entity]?.fields[parameter.field.field]
    : undefined;
  const enumName =
    parameter.enumName ?? (referencedField?.type === "enum" ? referencedField.enumName : undefined);
  return {
    ...parameter,
    type: parameter.type ?? referencedField?.type,
    ...(enumName ? { enumName, enumValues: enums[enumName] ?? [] } : {}),
  };
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
    const explorerMetadata = endpoints.map((endpoint) => ({
      name: names.get(endpoint),
      method: endpoint.method,
      path: endpoint.path,
      summary: endpoint.summary ?? endpoint.operationId,
      entity: endpoint.entity,
      authRequired: endpoint.authRequired,
      roles: endpoint.roles,
      permissions: endpoint.permissions,
      pathParams: endpoint.pathParams.map((parameter) =>
        explorerParameter(parameter, api.entities, api.enums),
      ),
      queryParams: endpoint.queryParams.map((parameter) =>
        explorerParameter(parameter, api.entities, api.enums),
      ),
      requestBody: endpoint.requestBody ?? null,
      bodyExample: bodyExample(endpoint, api.entities, api.enums),
      pagination: endpoint.pagination ?? null,
    }));
    const explorerDispatch = endpoints.map((endpoint) => {
      const name = names.get(endpoint) as string;
      return `  ${JSON.stringify(name)}: (input: unknown) => ${name}(input as ${name}Input),`;
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
      ...(endpoints.length > 0
        ? [
            {
              path: `${framework.codeRoot}/components/api/api-explorer.tsx`,
              content: `"use client";\n\nimport { useMemo, useState } from "react";\nimport { ApiError } from "@/lib/api/client";\nimport * as apiEndpoints from "@/lib/api/endpoints";\nimport type * as apiTypes from "@/lib/api/types";\nimport { Button } from "@/components/ui/button";\nimport { Notice } from "@/components/ui/notice";\n\ntype EndpointInfo = { readonly name: string; readonly method: string; readonly path: string; readonly summary: string; readonly entity: string; readonly authRequired: boolean; readonly roles: readonly string[]; readonly permissions: readonly string[]; readonly pathParams: readonly { readonly name: string; readonly type?: string; readonly required?: boolean; readonly enumName?: string; readonly enumValues?: readonly string[]; readonly field?: unknown }[]; readonly queryParams: readonly { readonly name: string; readonly type?: string; readonly required?: boolean; readonly enumName?: string; readonly enumValues?: readonly string[]; readonly operator?: string; readonly field?: unknown }[]; readonly requestBody: unknown; readonly bodyExample: Record<string, unknown>; readonly pagination: unknown };\nconst endpoints: readonly EndpointInfo[] = ${JSON.stringify(explorerMetadata, null, 2)};\nconst invoke: Record<string, (input: unknown) => Promise<unknown>> = {\n${explorerDispatch.map((entry) => entry.replace(/: \(input: unknown\) => (\w+)\(input as (\w+)Input\),/, ": (input: unknown) => apiEndpoints.$1(input as apiTypes.$2Input),")).join("\n")}\n};\nfunction exampleInput(endpoint: EndpointInfo): string {\n  const path = Object.fromEntries(endpoint.pathParams.map((item) => [item.name, item.type === "number" ? 1 : item.enumValues?.[0] ?? (item.type === "uuid" ? "00000000-0000-4000-8000-000000000000" : "")]));\n  const query = Object.fromEntries(endpoint.queryParams.map((item) => [item.name, item.type === "number" ? 1 : item.type === "boolean" ? false : item.enumValues?.[0] ?? ""]));\n  return JSON.stringify({ ...(endpoint.pathParams.length ? { path } : {}), ...(endpoint.queryParams.length || endpoint.pagination ? { query } : {}), ...(endpoint.requestBody ? { body: endpoint.bodyExample } : {}) }, null, 2);\n}\nexport function ApiExplorer() {\n  const [selected, setSelected] = useState<string>(endpoints[0]?.name ?? "");\n  const [input, setInput] = useState(() => endpoints[0] ? exampleInput(endpoints[0]) : "{}");\n  const [result, setResult] = useState<unknown>();\n  const [error, setError] = useState<string>();\n  const [pending, setPending] = useState(false);\n  const [parseError, setParseError] = useState<string>();\n  const active = useMemo(() => endpoints.find((endpoint) => endpoint.name === selected), [selected]);\n  async function run() {\n    if (!active) return;\n    setPending(true); setError(undefined); setParseError(undefined); setResult(undefined);\n    try {\n      const parsed: unknown = JSON.parse(input);\n      setResult(await invoke[active.name](parsed));\n    } catch (cause) {\n      if (cause instanceof SyntaxError) setParseError(cause.message);\n      else if (cause instanceof ApiError) setError(JSON.stringify({ status: cause.status, ...cause.problem }, null, 2));\n      else setError(cause instanceof Error ? cause.message : String(cause));\n    } finally { setPending(false); }\n  }\n  return <main className="ng-shell" style={{ padding: "32px 5vw" }}>\n    <section className="ng-panel" style={{ maxWidth: 1100, margin: "0 auto" }}>\n      <p className="ng-eyebrow">Connected backend contract</p><h1>API Explorer</h1>\n      <p className="ng-panel-note">Inspect and call every endpoint declared for this frontend. Requests use the generated typed client and include browser credentials. Backend authorization remains authoritative.</p>\n      <label className="ng-field"><span className="ng-label">Operation</span><select className="ng-input" value={selected} onChange={(event) => { const next = endpoints.find((item) => item.name === event.target.value); setSelected(event.target.value); if (next) setInput(exampleInput(next)); setResult(undefined); setError(undefined); }} aria-label="Select API operation">{endpoints.map((endpoint) => <option key={endpoint.name} value={endpoint.name}>{endpoint.method} {endpoint.path} — {endpoint.summary}</option>)}</select></label>\n      {active ? <div style={{ display: "grid", gap: 16, marginTop: 20 }}>\n        <div><strong>{active.entity}</strong><p>{active.summary}</p><p><code>{active.method} {active.path}</code></p>\n          {active.authRequired ? <p><strong>Authentication:</strong> required</p> : <p><strong>Authentication:</strong> no explicit requirement declared</p>}\n          {active.roles.length ? <p><strong>Allowed roles:</strong> {active.roles.join(", ")}</p> : null}\n          {active.permissions.length ? <p><strong>Required permissions:</strong> {active.permissions.join(", ")}</p> : null}\n          {active.pathParams.length ? <p><strong>Path parameters:</strong> {active.pathParams.map((item) => item.name + (item.required ? " (required)" : "")).join(", ")}</p> : null}\n          {active.queryParams.length ? <p><strong>Query parameters:</strong> {active.queryParams.map((item) => item.name + (item.required ? " (required)" : "") + (item.enumName ? " [enum: " + item.enumName + ": " + (item.enumValues ?? []).join(", ") + "]" : "")).join(", ")}</p> : null}\n          {active.requestBody ? <p><strong>Request body contract:</strong> <code>{JSON.stringify(active.requestBody)}</code></p> : null}\n          {active.pagination ? <p><strong>Pagination:</strong> <code>{JSON.stringify(active.pagination)}</code></p> : null}\n        </div>\n        <label className="ng-field"><span className="ng-label">Request input (JSON)</span><textarea className="ng-input" rows={14} spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} aria-describedby="api-input-help" /></label>\n        <small id="api-input-help">Use path, query, and body keys shown in the endpoint contract. Enums and field constraints are included above.</small>\n        {parseError ? <Notice tone="alert">Invalid JSON: {parseError}</Notice> : null}{error ? <pre role="alert" className="ng-notice ng-notice--alert" style={{ whiteSpace: "pre-wrap" }}>{error}</pre> : null}\n        <div><Button disabled={pending} onClick={() => void run()}>{pending ? "Sending…" : "Send request"}</Button></div>\n        {result !== undefined ? <section aria-live="polite"><h2>Response</h2><pre className="ng-panel" style={{ overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre></section> : null}\n      </div> : <Notice>No connected endpoints are declared.</Notice>}\n    </section></main>;\n}\n`,
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
  },
};
