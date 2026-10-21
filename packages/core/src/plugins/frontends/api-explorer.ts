/** Render the explorer separately from transport generation so its UI stays readable. */
export function apiExplorerSource(
  metadata: string,
  dispatch: string,
  authenticated: boolean,
): string {
  return `"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import * as apiEndpoints from "@/lib/api/endpoints";
import type * as apiTypes from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
${authenticated ? 'import { useSessionView } from "@/lib/auth/use-session-view";' : ""}

type FieldInfo = { name: string; type?: string; required?: boolean; nullable?: boolean; array?: boolean; enumValues?: readonly string[]; constraints?: readonly string[]; operator?: string };
type EndpointInfo = { name: string; id: string; backend: string; moduleId: string; method: string; path: string; summary: string; entity: string; authRequired: boolean; roles: readonly string[]; permissions: readonly string[]; pathParams: readonly FieldInfo[]; queryParams: readonly FieldInfo[]; requestBody: Record<string, Omit<FieldInfo, "name">> | null; bodyExample: Record<string, unknown>; pagination: { pageParam: string; pageSizeParam: string; defaultPageSize: number; maxPageSize: number } | null };
const endpoints: readonly EndpointInfo[] = ${metadata};
const invoke: Record<string, (input: unknown) => Promise<unknown>> = {
${dispatch}
};
function exampleInput(endpoint: EndpointInfo): string {
  const example = (item: FieldInfo) => {
    const value = item.type === "number" ? 1 : item.type === "boolean" ? false : item.type === "date" ? "2025-01-01T00:00:00.000Z" : item.type === "json" ? {} : item.enumValues?.[0] ?? (item.type === "uuid" ? "00000000-0000-4000-8000-000000000000" : "Example");
    return item.operator === "in" ? [value] : value;
  };
  const path = Object.fromEntries(endpoint.pathParams.map(item => [item.name, example(item)]));
  const query = Object.fromEntries(endpoint.queryParams.map(item => [item.name, example(item)]));
  return JSON.stringify({ ...(endpoint.pathParams.length ? { path } : {}), ...(endpoint.queryParams.length || endpoint.pagination ? { query } : {}), ...(endpoint.requestBody ? { body: endpoint.bodyExample } : {}) }, null, 2);
}
function ContractFields({ title, fields }: { title: string; fields: readonly FieldInfo[] }) {
  if (!fields.length) return null;
  return <section className="ng-contract-section"><h3>{title}</h3><div className="ng-table-wrap"><table className="ng-table ng-contract-table" aria-label={title}>
    <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Rules</th></tr></thead>
    <tbody>{fields.map(field => <tr key={field.name}><th scope="row"><code>{field.name}</code></th><td><code>{field.type}{field.array || field.operator === "in" ? "[]" : ""}</code><small>{field.required ? "Required" : "Optional"}{field.nullable ? " · Nullable" : ""}</small></td><td>{[...(field.enumValues?.length ? ["One of: " + field.enumValues.join(", ")] : []), ...(field.constraints ?? []), ...(field.operator ? ["Filter: " + field.operator] : [])].map(rule => <div key={rule}>{rule}</div>)}{!field.enumValues?.length && !field.constraints?.length && !field.operator ? <span className="ng-muted">—</span> : null}</td></tr>)}</tbody>
  </table></div></section>;
}
export function ApiExplorer() {
${authenticated ? "  const session = useSessionView();" : ""}
  const [selected, setSelected] = useState<string>(endpoints[0]?.name ?? "");
  const [input, setInput] = useState(() => endpoints[0] ? exampleInput(endpoints[0]) : "{}");
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [parseError, setParseError] = useState<string>();
  const active = useMemo(() => endpoints.find(endpoint => endpoint.name === selected), [selected]);
  const allowed = ${authenticated ? "Boolean(active && session.canAccess(active))" : "Boolean(active)"};
  const accessMessage = ${authenticated ? '!allowed ? session.isPending ? "Checking your session before enabling this request." : !session.user ? "Sign in to send this request." : "Your account does not have the roles or permissions required to send this request." : undefined' : "undefined"};
  async function run() {
    if (!active || !allowed || pending) return;
    setPending(true); setError(undefined); setParseError(undefined); setResult(undefined);
    try {
      const parsed: unknown = JSON.parse(input);
      setResult(await invoke[active.name](parsed));
    } catch (cause) {
      if (cause instanceof SyntaxError) setParseError(cause.message);
      else if (cause instanceof ApiError) setError(JSON.stringify({ status: cause.status, ...cause.problem }, null, 2));
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setPending(false); }
  }
  return <main className="ng-shell ng-explorer">
    <div className="ng-explorer-container">
      <header className="ng-explorer-heading"><Link className="ng-text-link" href="/">← Workspace</Link><p className="ng-eyebrow">Developer tools</p><h1>API Explorer</h1><p>Choose an operation, review its fields and try a request.</p></header>
      <section className="ng-panel ng-operation-picker" aria-label="Operation selection">
        <label className="ng-field"><span className="ng-label">Operation · {endpoints.length} available</span><select className="ng-input" disabled={pending} value={selected} onChange={event => { const next = endpoints.find(item => item.name === event.target.value); setSelected(event.target.value); if (next) setInput(exampleInput(next)); setResult(undefined); setError(undefined); setParseError(undefined); }} aria-label="Select API operation">{endpoints.map(endpoint => <option key={endpoint.name} value={endpoint.name}>{endpoint.entity} · {endpoint.method} {endpoint.path} — {endpoint.summary}</option>)}</select></label>
      </section>
      {active ? <>
        <section className="ng-endpoint-heading" aria-label="Selected operation"><div className="ng-endpoint-path"><span className={"ng-method ng-method--" + active.method.toLowerCase()}>{active.method}</span><code>{active.path}</code></div><h2>{active.summary}</h2><p>{active.entity} <span aria-hidden="true">·</span> {active.backend} <span aria-hidden="true">·</span> {active.moduleId}</p></section>
        <div className="ng-explorer-grid">
          <section className="ng-panel ng-contract" aria-label="Operation contract"><p className="ng-eyebrow">Reference</p><h2>Request contract</h2>
            <section className="ng-contract-section"><h3>Access</h3><dl className="ng-access-details"><div><dt>Session</dt><dd>{active.authRequired || active.roles.length || active.permissions.length ? "Sign-in required" : "Public operation"}</dd></div>{active.roles.length ? <div><dt>Allowed roles</dt><dd>{active.roles.join(", ")}</dd></div> : null}{active.permissions.length ? <div><dt>Required permissions</dt><dd>{active.permissions.join(", ")}</dd></div> : null}</dl></section>
            <ContractFields title="Path parameters" fields={active.pathParams} />
            <ContractFields title="Query parameters" fields={active.queryParams} />
            {active.requestBody ? <ContractFields title="Request body" fields={Object.entries(active.requestBody).map(([name, field]) => ({ name, ...field }))} /> : <p className="ng-panel-note">This operation has no request body.</p>}
            {active.pagination ? <section className="ng-contract-section"><h3>Pagination</h3><p className="ng-panel-note">Use query.{active.pagination.pageParam} and query.{active.pagination.pageSizeParam}. Default: {active.pagination.defaultPageSize} records; maximum: {active.pagination.maxPageSize}.</p></section> : null}
          </section>
          <section className="ng-panel ng-request" aria-label="Try request"><p className="ng-eyebrow">Playground</p><h2>Try it out</h2>
            <label className="ng-field"><span className="ng-label">Request input (JSON)</span><textarea className="ng-input ng-json-editor" rows={14} spellCheck={false} disabled={pending} value={input} onChange={event => setInput(event.target.value)} aria-describedby="api-input-help" /></label>
            <small id="api-input-help" className="ng-input-help">Edit path, query and body values using the reference. Requests run with your current session.</small>
            {parseError ? <Notice tone="alert">Invalid JSON: {parseError}</Notice> : null}
            {accessMessage ? <Notice id="api-operation-access">{accessMessage}</Notice> : null}
            <Button aria-describedby={accessMessage ? "api-operation-access" : undefined} disabled={pending || !allowed} onClick={() => void run()}>{pending ? "Sending…" : "Send request"}</Button>
            {error ? <section role="alert"><h3>Request failed</h3><pre className="ng-json-output ng-json-output--error">{error}</pre></section> : null}
            {result !== undefined ? <section aria-live="polite"><h2>Response</h2><pre className="ng-json-output">{JSON.stringify(result, null, 2)}</pre></section> : null}
          </section>
        </div>
      </> : <Notice>No connected endpoints are declared.</Notice>}
    </div>
  </main>;
}
`;
}
