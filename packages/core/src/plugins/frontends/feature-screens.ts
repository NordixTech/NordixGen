import type { TransportField, TransportOperation } from "../../project/types.js";
import type { GeneratedFile } from "../contracts.js";
import type { FrontendApiEntity, FrontendRenderContext } from "../frontend-contracts.js";
function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function source(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}
export interface EntityEndpointsGroup {
  readonly entityName: string;
  readonly listEndpoint?: TransportOperation;
  readonly getEndpoint?: TransportOperation;
  readonly createEndpoint?: TransportOperation;
  readonly updateEndpoint?: TransportOperation;
  readonly deleteEndpoint?: TransportOperation;
  readonly customEndpoints: readonly TransportOperation[];
}
function endpointBodyFields(
  endpoint: TransportOperation | undefined,
): Readonly<Record<string, TransportField>> {
  return Object.fromEntries(
    Object.entries(endpoint?.body.fields ?? {}).map(([name, input]) => [
      name,
      { ...input.definition, required: !input.optional },
    ]),
  );
}
function slugify(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
function fieldInputs(fields: Readonly<Record<string, TransportField>>): string {
  return Object.entries(fields)
    .map(([name, field]) => {
      const key = JSON.stringify(name);
      const disabled = field.nullable ? `disabled={featureForm.watch(${key})===null}` : "";
      const nullControl = field.nullable
        ? `<label className="ng-label"><input aria-label="Set ${name} to null" type="checkbox" checked={featureForm.watch(${key})===null} onChange={event=>featureForm.setValue(${key},event.target.checked?null:${field.type === "boolean" ? "false" : "undefined"})} /> Set ${name} to null</label>`
        : "";
      const register = `{...featureForm.register(${key})}`;
      const input =
        field.type === "enum"
          ? `<select className="ng-input" id="${name}" ${disabled} ${register}><option value="">Select ${name}...</option>${(field.value.enumValues as readonly string[]).map((value) => `<option value={${JSON.stringify(value)}}>${escapeText(value)}</option>`).join("")}</select>`
          : field.type === "json"
            ? `<textarea className="ng-input" aria-label="${name}" id="${name}" rows={4} ${disabled} ${register} />`
            : field.type === "boolean"
              ? `<input className="ng-checkbox" aria-label="${name}" id="${name}" type="checkbox" ${disabled} ${register} />`
              : `<input className="ng-input" id="${name}" type="${field.type === "number" ? "number" : field.type === "date" ? "datetime-local" : "text"}" ${field.type === "number" ? `step="${field.format === "integer" ? "1" : "any"}"` : field.type === "date" ? 'step="1"' : ""} ${disabled} ${register} />`;
      return `<div className="ng-field"><label className="ng-label" htmlFor="${name}">${name}${field.required ? " *" : ""}</label>${nullControl}${input}<small role="status">{String(featureForm.formState.errors[${key}]?.message??"")}</small></div>`;
    })
    .join("\n");
}
function generateFeatureView(
  group: EntityEndpointsGroup,
  entity: FrontendApiEntity,
  operationNames: ReadonlyMap<TransportOperation, string>,
  hasAuth: boolean,
): string {
  const entityName = group.entityName;
  const listOp = group.listEndpoint ? operationNames.get(group.listEndpoint) : undefined;
  const createOp = group.createEndpoint ? operationNames.get(group.createEndpoint) : undefined;
  const updateOp = group.updateEndpoint ? operationNames.get(group.updateEndpoint) : undefined;
  const deleteOp = group.deleteEndpoint ? operationNames.get(group.deleteEndpoint) : undefined;
  const entityFields = entity.fields;
  const deleteMessage =
    entity.softDelete === "boolean"
      ? "This record will be marked inactive and hidden from active lists."
      : entity.softDelete === "timestamp"
        ? "This record will be archived using the backend soft-delete policy."
        : "This action permanently removes this record.";
  const permissionStart = (endpoint: TransportOperation | undefined) =>
    hasAuth && endpoint
      ? `{canAccess(${JSON.stringify({ authRequired: endpoint.authRequired, roles: endpoint.roles, permissions: endpoint.permissions })}) && (`
      : "";
  const permissionEnd = (endpoint: TransportOperation | undefined) =>
    permissionStart(endpoint) ? ")}" : "";
  const filterParams = group.listEndpoint?.queryParams ?? [];
  const hasPagination = Boolean(group.listEndpoint?.pagination);
  const fields = Object.entries(entityFields);
  const generatedInputTypes = [...new Set([createOp, updateOp, deleteOp].filter(Boolean))];
  const imports: string[] = ['"use client";', ""];
  imports.push(
    'import { useState,type FormEvent } from "react";',
    'import { useForm } from "react-hook-form";',
    'import { zodResolver } from "@hookform/resolvers/zod";',
    'import { z } from "zod";',
    'import { Button } from "@/components/ui/button";',
    'import { Dialog } from "@/components/ui/dialog";',
    'import { Input } from "@/components/ui/input";',
    'import { Notice } from "@/components/ui/notice";',
    'import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";',
  );
  {
    const hookImports: string[] = [];
    if (listOp) hookImports.push(`use${listOp[0]?.toUpperCase()}${listOp.slice(1)}`);
    if (createOp) hookImports.push(`use${createOp[0]?.toUpperCase()}${createOp.slice(1)}`);
    if (updateOp) hookImports.push(`use${updateOp[0]?.toUpperCase()}${updateOp.slice(1)}`);
    if (deleteOp) hookImports.push(`use${deleteOp[0]?.toUpperCase()}${deleteOp.slice(1)}`);
    if (hookImports.length) {
      imports.push(`import { ${hookImports.join(", ")} } from "@/lib/api/hooks";`);
    }
  }
  if (hasAuth) {
    imports.push('import { useSessionView } from "@/lib/auth/use-session-view";');
  }
  imports.push(`import type {${entityName}Response} from "@/lib/api/types";`);
  if (generatedInputTypes.length)
    imports.push(
      `import {formDefaults,${generatedInputTypes.flatMap((name) => [`${name}FormInput`, ...(name === deleteOp ? [] : [`${name}FormSchema`])]).join(",")}} from "@/lib/api/forms";`,
    );
  if (listOp && filterParams.length)
    imports.push(
      `import type {${listOp}Input} from "@/lib/api/types";`,
      `import {${listOp}QueryFormInput} from "@/lib/api/forms";`,
    );
  const queryState = [
    ...(hasPagination ? ["  const [page, setPage] = useState(1);"] : []),
    ...(listOp && filterParams.length
      ? [
          `  const [filters,setFilters]=useState<${listOp}Input["query"]>({});`,
          "  const [filterError,setFilterError]=useState<string|null>(null);",
          `  const applyFilters=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();try{const next=${listOp}QueryFormInput(Object.fromEntries(new FormData(event.currentTarget)));setFilters(next.query);setFilterError(null);${hasPagination ? "setPage(1);" : ""}}catch{setFilterError("Please correct the filter values.");}};`,
        ]
      : []),
  ].join("\n");
  const queryFields = [
    ...(filterParams.length ? ["...filters"] : []),
    ...(hasPagination
      ? [
          `${JSON.stringify(group.listEndpoint?.pagination?.pageParam)}: page`,
          `${JSON.stringify(group.listEndpoint?.pagination?.pageSizeParam)}: ${group.listEndpoint?.pagination?.defaultPageSize}`,
        ]
      : []),
  ];
  const queryParam = queryFields.length ? `{ query: { ${queryFields.join(", ")} } }` : "{}";
  const hookCalls: string[] = [];
  if (listOp) {
    hookCalls.push(
      `  const { data, isLoading, error } = use${listOp[0]?.toUpperCase()}${listOp.slice(1)}(${queryParam});`,
    );
  }
  if (createOp) {
    hookCalls.push(
      `  const createMutation = use${createOp[0]?.toUpperCase()}${createOp.slice(1)}();`,
    );
  }
  if (updateOp) {
    hookCalls.push(
      `  const updateMutation = use${updateOp[0]?.toUpperCase()}${updateOp.slice(1)}();`,
    );
  }
  if (deleteOp) {
    hookCalls.push(
      `  const deleteMutation = use${deleteOp[0]?.toUpperCase()}${deleteOp.slice(1)}();`,
    );
  }
  if (!listOp)
    hookCalls.push(
      "  const {data,isLoading,error} = {data: [],isLoading:false,error:null as Error | null};",
    );
  const itemsAccessor = !listOp
    ? "  const items:readonly FeatureRow[]=[];"
    : hasPagination
      ? "  const items=data?.items??[];"
      : "  const items=data??[];";
  const tableHeaders = fields
    .slice(0, 5)
    .map(([name]) => `            <TableHeaderCell>${name}</TableHeaderCell>`)
    .join("\n");
  const tableCells = fields
    .slice(0, 5)
    .map(
      ([name]) =>
        `              <TableCell>{String(row.entity[${JSON.stringify(name)}]??"")}</TableCell>`,
    )
    .join("\n");
  const createForm =
    createOp || updateOp
      ? `      <Dialog onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setEditingItem(null); }} open={isCreateOpen} title={editingItem ? "Edit ${entityName}" : "Create ${entityName}"}>
        <form className="ng-form" onSubmit={featureForm.handleSubmit(handleSave)}>
          {mutationError ? <Notice tone="alert">{mutationError}</Notice> : null}
{editingItem?<>${fieldInputs(endpointBodyFields(group.updateEndpoint))}</>:<>${fieldInputs(endpointBodyFields(group.createEndpoint))}</>}
          {Object.keys(featureForm.formState.errors).length>0?<Notice tone="alert">Please correct the marked fields before saving.</Notice>:null}
          <div className="ng-actions" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => { setIsCreateOpen(false); setEditingItem(null); featureForm.reset({}); }} type="button" variant="secondary">Cancel</Button>
            <Button disabled={isSubmitting} type="submit">{isSubmitting ? "Saving..." : editingItem ? "Save changes" : "Create"}</Button>
          </div>
        </form>
      </Dialog>`
      : "";
  const deleteDialog = deleteOp
    ? `      <Dialog onOpenChange={(open) => !open && setDeletingItem(null)} open={Boolean(deletingItem)} title="Delete ${entityName}">
        <div>
          <p>Are you sure you want to delete this record? ${deleteMessage}</p>
          {mutationError ? <Notice tone="alert">{mutationError}</Notice> : null}
          <div className="ng-actions" style={{ justifyContent: "flex-end", marginTop: "24px" }}>
            <Button onClick={() => setDeletingItem(null)} type="button" variant="secondary">Cancel</Button>
            <Button disabled={isSubmitting} onClick={handleDelete} type="button" variant="danger">{isSubmitting ? "Deleting..." : "Confirm Delete"}</Button>
          </div>
        </div>
      </Dialog>`
    : "";
  const paginationControls = hasPagination
    ? `        <div className="ng-actions" style={{ justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
          <span>Page {page}</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} type="button" variant="secondary">Previous</Button>
            <Button disabled={isLoading || !data || data.page*data.pageSize>=data.total} onClick={() => setPage((p) => p + 1)} type="button" variant="secondary">Next</Button>
          </div>
        </div>`
    : "";
  return source([
    ...imports,
    "",
    `type FeatureRow={readonly entity:${entityName}Response};`,
    "",
    `export function ${entityName}FeatureScreen() {`,
    `  const createSchema:z.ZodType<Record<string,unknown>>=${createOp ? `${createOp}FormSchema` : "z.object({})"};`,
    `  const updateSchema:z.ZodType<Record<string,unknown>>=${updateOp ? `${updateOp}FormSchema` : "z.object({})"};`,
    queryState,
    "  const [isCreateOpen, setIsCreateOpen] = useState(false);",
    "  const [editingItem, setEditingItem] = useState<FeatureRow | null>(null);",
    "  const [deletingItem, setDeletingItem] = useState<FeatureRow | null>(null);",
    "  const [mutationError, setMutationError] = useState<string | null>(null);",
    "  const [isSubmitting, setIsSubmitting] = useState(false);",
    "  const featureForm = useForm<Record<string, unknown>>({ resolver: zodResolver(editingItem ? updateSchema : createSchema) });",
    hasAuth ? "  const {canAccess,isPending:isSessionPending} = useSessionView();" : "",
    `  const readAllowed=${hasAuth && group.listEndpoint ? `canAccess(${JSON.stringify({ authRequired: group.listEndpoint.authRequired, roles: group.listEndpoint.roles, permissions: group.listEndpoint.permissions })})` : "true"};`,
    "",
    ...hookCalls,
    "",
    itemsAccessor,
    "",
    "  const handleSave = async () => {",
    "    const body=featureForm.getValues();",
    "    setMutationError(null);",
    "    setIsSubmitting(true);",
    "    try {",
    "      if (editingItem) {",
    updateOp
      ? `        await updateMutation.mutateAsync(${updateOp}FormInput(body,editingItem.entity.id));`
      : '        throw new Error("This entity has no update endpoint.");',
    "      } else {",
    createOp
      ? `        await createMutation.mutateAsync(${createOp}FormInput(body));`
      : '        throw new Error("This entity has no create endpoint.");',
    "      }",
    "      setIsCreateOpen(false);",
    "      setEditingItem(null);",
    "      featureForm.reset({});",
    "    } catch (err: unknown) {",
    "      setMutationError(err instanceof Error ? err.message : String(err));",
    "    } finally {",
    "      setIsSubmitting(false);",
    "    }",
    "  };",
    "",
    "  const handleDelete = async () => {",
    "    if (!deletingItem) return;",
    "    setMutationError(null);",
    "    setIsSubmitting(true);",
    "    const id=deletingItem.entity.id;",
    "    try {",
    deleteOp
      ? `      await deleteMutation.mutateAsync(${deleteOp}FormInput({},id));`
      : "      // No delete endpoint",
    "      setDeletingItem(null);",
    "    } catch (err: unknown) {",
    "      setMutationError(err instanceof Error ? err.message : String(err));",
    "    } finally {",
    "      setIsSubmitting(false);",
    "    }",
    "  };",
    "",
    "  return (",
    '    <div className="ng-feature-screen" style={{ display: "grid", gap: "24px" }}>',
    '      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>',
    "        <div>",
    `          <h2 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>${entityName} Management</h2>`,
    `          <p style={{ margin: "4px 0 0", color: "var(--ng-muted)" }}>Explore, filter and manage ${entityName} records.</p>`,
    "        </div>",
    createOp
      ? `        ${permissionStart(group.createEndpoint)}<Button onClick={() => { setEditingItem(null); featureForm.reset(formDefaults(${JSON.stringify(createOp as string)})); setMutationError(null); setIsCreateOpen(true); }} type="button">+ New ${entityName}</Button>${permissionEnd(group.createEndpoint)}`
      : "",
    "      </div>",
    "",
    '      {error ? <Notice tone="alert">{error.message ?? "Failed to load records"}</Notice> : null}',
    "",
    '      <div className="ng-panel" style={{ padding: "16px" }}>',
    ...(filterParams.length
      ? [
          `        <form className="ng-form" onSubmit={applyFilters}>${filterParams
            .map((parameter) => {
              const field = parameter.definition;
              const key = JSON.stringify(parameter.name);
              const label =
                parameter.name === "search"
                  ? "Filter records"
                  : parameter.name + (parameter.input.array ? " (JSON array)" : "");
              if (field.type === "enum" && !parameter.input.array)
                return `<label className="ng-field"><span className="ng-label">${label}</span><select className="ng-input" name=${key}><option value="">All</option>${(field.value.enumValues as readonly string[]).map((value) => `<option value={${JSON.stringify(value)}}>${escapeText(value)}</option>`).join("")}</select></label>`;
              if (field.type === "boolean" && !parameter.input.array)
                return `<label className="ng-field"><span className="ng-label">${label}</span><select className="ng-input" name=${key}><option value="">All</option><option value="true">True</option><option value="false">False</option></select></label>`;
              return `<Input id="filter-${parameter.name}" label="${label}" name=${key} type="${field.type === "number" && !parameter.input.array ? "number" : field.type === "date" && !parameter.input.array ? "datetime-local" : "text"}" ${field.type === "number" ? 'step="any"' : ""} />`;
            })
            .join(
              "",
            )}<Button type="submit">Apply filters</Button>{filterError?<Notice tone="alert">{filterError}</Notice>:null}</form>`,
        ]
      : []),
    "",
    `        {!readAllowed ? <Notice>${hasAuth ? '{isSessionPending?"Checking session…":"A permitted session is required to read these records."}' : "A permitted session is required to read these records."}</Notice> : isLoading ? (`,
    '          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ng-muted)" }}>Loading records...</div>',
    "        ) : items.length === 0 ? (",
    `          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ng-muted)" }}>${listOp ? "No records found." : "No list operation is declared. Use API Explorer to provide explicit operation inputs."}</div>`,
    "        ) : (",
    "          <Table>",
    "            <TableHead>",
    "              <TableRow>",
    tableHeaders,
    updateOp || deleteOp ? "                <TableHeaderCell>Actions</TableHeaderCell>" : "",
    "              </TableRow>",
    "            </TableHead>",
    "            <TableBody>",
    "              {items.map((row: FeatureRow, idx: number) => {",
    "                const rawKey=row.entity.id;",
    '                const itemKey = typeof rawKey === "string" || typeof rawKey === "number" ? rawKey : idx;',
    "                return (",
    "                  <TableRow key={itemKey}>",
    tableCells,
    updateOp || deleteOp
      ? `                    <TableCell>
                      ${updateOp ? `${permissionStart(group.updateEndpoint)}<Button onClick={() => { featureForm.reset(formDefaults(${JSON.stringify(updateOp as string)},row.entity)); setEditingItem(row); setMutationError(null); setIsCreateOpen(true); }} type="button" variant="secondary">Edit</Button>${permissionEnd(group.updateEndpoint)}` : ""}
                      ${deleteOp ? `${permissionStart(group.deleteEndpoint)}<Button onClick={() => setDeletingItem(row)} type="button" variant="danger">Delete</Button>${permissionEnd(group.deleteEndpoint)}` : ""}
                    </TableCell>`
      : "",
    "                  </TableRow>",
    "                );",
    "              })}",
    "            </TableBody>",
    "          </Table>",
    "        )}",
    paginationControls,
    "      </div>",
    "",
    createForm,
    deleteDialog,
    "    </div>",
    "  );",
    "}",
  ]);
}
export function generateFeatureScreenFiles(
  context: FrontendRenderContext,
): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const endpoints = context.api.endpoints;
  if (endpoints.length === 0) return [];
  const byId = Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const groups = new Map(
    Object.entries(context.api.features).map(([entityName, feature]) => [
      entityName,
      {
        entityName,
        listEndpoint: feature.list ? byId[feature.list] : undefined,
        getEndpoint: feature.get ? byId[feature.get] : undefined,
        createEndpoint: feature.create ? byId[feature.create] : undefined,
        updateEndpoint: feature.update ? byId[feature.update] : undefined,
        deleteEndpoint: feature.delete ? byId[feature.delete] : undefined,
        customEndpoints: feature.custom.map((id) => byId[id]),
      },
    ]),
  );
  const operationNames = new Map(
    endpoints.map((endpoint) => [endpoint, context.api.operationNames[endpoint.id]]),
  );
  const hasAuth = Boolean(context.api.authentication);
  const files: GeneratedFile[] = [];
  for (const [entityName, group] of groups.entries()) {
    const slug = slugify(entityName);
    const entity = context.api.entities[entityName];
    const screenContent = generateFeatureView(group, entity, operationNames, hasAuth);
    files.push({
      path: `${root}/components/features/${slug}-screen.tsx`,
      content: screenContent,
    });
    files.push({
      path: `${root}/app/${slug}/page.tsx`,
      content: source([
        `import { ${entityName}FeatureScreen } from "@/components/features/${slug}-screen";`,
        "",
        `export const metadata = { title: "${entityName} Records | NordixGen" };`,
        "",
        `export default function ${entityName}Page() {`,
        "  return (",
        '    <main className="ng-shell" style={{ padding: "40px 5vw" }}>',
        `      <${entityName}FeatureScreen />`,
        "    </main>",
        "  );",
        "}",
      ]),
    });
  }
  return files;
}
