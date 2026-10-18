import type {
  TransportField,
  TransportInput,
  TransportOperation,
  TransportParameter,
} from "../../project/types.js";
import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";

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
function explorerParameter(parameter: TransportParameter) {
  return {
    name: parameter.name,
    type: parameter.definition.type,
    required: parameter.required,
    ...(parameter.operator ? { operator: parameter.operator } : {}),
    ...(parameter.definition.type === "enum"
      ? {
          enumName: parameter.definition.enumName,
          enumValues: parameter.definition.value.enumValues,
        }
      : {}),
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
        `${JSON.stringify(name)}:process.env.NEXT_PUBLIC_${name.toUpperCase().replaceAll("-", "_")}_BASE_URL${context.frontend.connections.length === 1 ? ' ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? ""' : ' ?? ""'}`,
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
                type: input.definition.type,
                required: !input.optional,
                nullable: input.nullable,
              },
            ]),
          ),
    bodyExample: bodyExample(endpoint),
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
            content: `"use client";\n\nimport { useMemo, useState } from "react";\nimport { ApiError } from "@/lib/api/client";\nimport * as apiEndpoints from "@/lib/api/endpoints";\nimport type * as apiTypes from "@/lib/api/types";\nimport { Button } from "@/components/ui/button";\nimport { Notice } from "@/components/ui/notice";\n${api.authentication ? 'import {useSessionView} from "@/lib/auth/use-session-view";' : ""}\n\ntype EndpointInfo = { readonly name: string; readonly id:string;readonly backend:string;readonly moduleId:string; readonly method: string; readonly path: string; readonly summary: string; readonly entity: string; readonly authRequired: boolean; readonly roles: readonly string[]; readonly permissions: readonly string[]; readonly pathParams: readonly { readonly name: string; readonly type?: string; readonly required?: boolean; readonly enumName?: string; readonly enumValues?: readonly string[]; readonly field?: unknown }[]; readonly queryParams: readonly { readonly name: string; readonly type?: string; readonly required?: boolean; readonly enumName?: string; readonly enumValues?: readonly string[]; readonly operator?: string; readonly field?: unknown }[]; readonly requestBody: unknown; readonly bodyExample: Record<string, unknown>; readonly pagination: unknown };\nconst endpoints: readonly EndpointInfo[] = ${JSON.stringify(explorerMetadata, null, 2)};\nconst invoke: Record<string, (input: unknown) => Promise<unknown>> = {\n${explorerDispatch.map((entry) => entry.replace(/: \(input: unknown\) => (\w+)\(input as (\w+)Input\),/, ": (input: unknown) => apiEndpoints.$1(input as apiTypes.$2Input),")).join("\n")}\n};\nfunction exampleInput(endpoint: EndpointInfo): string {\n  const example=(item:{type?:string;enumValues?:readonly string[];operator?:string})=>{const value=item.type==="number"?1:item.type==="boolean"?false:item.type==="date"?"2025-01-01T00:00:00.000Z":item.type==="json"?{}:item.enumValues?.[0]??(item.type==="uuid"?"00000000-0000-4000-8000-000000000000":"Example");return item.operator==="in"?[value]:value;};\n  const path=Object.fromEntries(endpoint.pathParams.map(item=>[item.name,example(item)]));\n  const query=Object.fromEntries(endpoint.queryParams.map(item=>[item.name,example(item)]));\n  return JSON.stringify({ ...(endpoint.pathParams.length ? { path } : {}), ...(endpoint.queryParams.length || endpoint.pagination ? { query } : {}), ...(endpoint.requestBody ? { body: endpoint.bodyExample } : {}) }, null, 2);\n}\nexport function ApiExplorer() {\n${api.authentication ? "  const session=useSessionView();" : ""}\n  const [selected, setSelected] = useState<string>(endpoints[0]?.name ?? "");\n  const [input, setInput] = useState(() => endpoints[0] ? exampleInput(endpoints[0]) : "{}");\n  const [result, setResult] = useState<unknown>();\n  const [error, setError] = useState<string>();\n  const [pending, setPending] = useState(false);\n  const [parseError, setParseError] = useState<string>();\n  const active = useMemo(() => endpoints.find((endpoint) => endpoint.name === selected), [selected]);\n  const allowed=${api.authentication ? "Boolean(active && session.canAccess(active))" : "Boolean(active)"};\n  async function run() {\n    if (!active || !allowed) return;\n    setPending(true); setError(undefined); setParseError(undefined); setResult(undefined);\n    try {\n      const parsed: unknown = JSON.parse(input);\n      setResult(await invoke[active.name](parsed));\n    } catch (cause) {\n      if (cause instanceof SyntaxError) setParseError(cause.message);\n      else if (cause instanceof ApiError) setError(JSON.stringify({ status: cause.status, ...cause.problem }, null, 2));\n      else setError(cause instanceof Error ? cause.message : String(cause));\n    } finally { setPending(false); }\n  }\n  return <main className="ng-shell" style={{ padding: "32px 5vw" }}>\n    <section className="ng-panel" style={{ maxWidth: 1100, margin: "0 auto" }}>\n      <p className="ng-eyebrow">Connected backend contract</p><h1>API Explorer</h1>\n      <p className="ng-panel-note">Inspect and call every endpoint declared for this frontend. Requests use the generated typed client and include browser credentials. Backend authorization remains authoritative.</p>\n      <label className="ng-field"><span className="ng-label">Operation</span><select className="ng-input" value={selected} onChange={(event) => { const next = endpoints.find((item) => item.name === event.target.value); setSelected(event.target.value); if (next) setInput(exampleInput(next)); setResult(undefined); setError(undefined); }} aria-label="Select API operation">{endpoints.map((endpoint) => <option key={endpoint.name} value={endpoint.name}>{endpoint.backend} · {endpoint.method} {endpoint.path} — {endpoint.summary}</option>)}</select></label>\n      {active ? <div style={{ display: "grid", gap: 16, marginTop: 20 }}>\n        <div><strong>{active.entity}</strong><p>{active.summary}</p><p><code>{active.method} {active.path}</code></p>\n          {active.authRequired ? <p><strong>Authentication:</strong> required</p> : <p><strong>Authentication:</strong> no explicit requirement declared</p>}\n          {active.roles.length ? <p><strong>Allowed roles:</strong> {active.roles.join(", ")}</p> : null}\n          {active.permissions.length ? <p><strong>Required permissions:</strong> {active.permissions.join(", ")}</p> : null}\n          {active.pathParams.length ? <p><strong>Path parameters:</strong> {active.pathParams.map((item) => item.name + (item.required ? " (required)" : "")).join(", ")}</p> : null}\n          {active.queryParams.length ? <p><strong>Query parameters:</strong> {active.queryParams.map((item) => item.name + (item.required ? " (required)" : "") + (item.enumName ? " [enum: " + item.enumName + ": " + (item.enumValues ?? []).join(", ") + "]" : "")).join(", ")}</p> : null}\n          {active.requestBody ? <p><strong>Request body contract:</strong> <code>{JSON.stringify(active.requestBody)}</code></p> : null}\n          {active.pagination ? <p><strong>Pagination:</strong> <code>{JSON.stringify(active.pagination)}</code></p> : null}\n        </div>\n        <label className="ng-field"><span className="ng-label">Request input (JSON)</span><textarea className="ng-input" rows={14} spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} aria-describedby="api-input-help" /></label>\n        <small id="api-input-help">Use path, query, and body keys shown in the endpoint contract. Enums and field constraints are included above.</small>\n        {parseError ? <Notice tone="alert">Invalid JSON: {parseError}</Notice> : null}{error ? <pre role="alert" className="ng-notice ng-notice--alert" style={{ whiteSpace: "pre-wrap" }}>{error}</pre> : null}\n        <div><Button disabled={pending || !allowed} onClick={() => void run()}>{pending ? "Sending…" : "Send request"}</Button></div>\n        {result !== undefined ? <section aria-live="polite"><h2>Response</h2><pre className="ng-panel" style={{ overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre></section> : null}\n      </div> : <Notice>No connected endpoints are declared.</Notice>}\n    </section></main>;\n}\n`,
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
