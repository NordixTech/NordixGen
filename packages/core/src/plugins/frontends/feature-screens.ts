import type { FieldDefinition, NormalizedEndpointDefinition } from "../../configuration/schema.js";
import type { GeneratedFile } from "../contracts.js";
import type {
  FrontendApiEntity,
  FrontendGeneratorPlugin,
  FrontendPluginContributionContext,
} from "../frontend-contracts.js";
import { getFrontendOperationNames } from "../frontend-operation-names.js";

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function source(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

export interface EntityEndpointsGroup {
  readonly entityName: string;
  readonly listEndpoint?: NormalizedEndpointDefinition;
  readonly getEndpoint?: NormalizedEndpointDefinition;
  readonly createEndpoint?: NormalizedEndpointDefinition;
  readonly updateEndpoint?: NormalizedEndpointDefinition;
  readonly deleteEndpoint?: NormalizedEndpointDefinition;
  readonly customEndpoints: readonly NormalizedEndpointDefinition[];
}

export function groupEndpointsByEntity(
  endpoints: readonly NormalizedEndpointDefinition[],
): ReadonlyMap<string, EntityEndpointsGroup> {
  const groups = new Map<string, {
    entityName: string;
    listEndpoint?: NormalizedEndpointDefinition;
    getEndpoint?: NormalizedEndpointDefinition;
    createEndpoint?: NormalizedEndpointDefinition;
    updateEndpoint?: NormalizedEndpointDefinition;
    deleteEndpoint?: NormalizedEndpointDefinition;
    customEndpoints: NormalizedEndpointDefinition[];
  }>();

  for (const endpoint of endpoints) {
    let group = groups.get(endpoint.entity);
    if (!group) {
      group = {
        entityName: endpoint.entity,
        customEndpoints: [],
      };
      groups.set(endpoint.entity, group);
    }

    if (endpoint.method === "GET" && endpoint.pathParams.length === 0 && !group.listEndpoint) {
      group.listEndpoint = endpoint;
    } else if (endpoint.method === "GET" && endpoint.pathParams.length > 0 && !group.getEndpoint) {
      group.getEndpoint = endpoint;
    } else if (endpoint.method === "POST" && !group.createEndpoint) {
      group.createEndpoint = endpoint;
    } else if ((endpoint.method === "PATCH" || endpoint.method === "PUT") && !group.updateEndpoint) {
      group.updateEndpoint = endpoint;
    } else if (endpoint.method === "DELETE" && !group.deleteEndpoint) {
      group.deleteEndpoint = endpoint;
    } else {
      group.customEndpoints.push(endpoint);
    }
  }

  return groups;
}

function slugify(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function fieldInputs(
  fields: Readonly<Record<string, FieldDefinition>>,
  enums: Readonly<Record<string, readonly string[]>>,
  editing = false,
): string {
  const generatedFields = new Set(["id", "createdAt", "updatedAt", "isDeleted", "deletedAt"]);
  const entries = Object.entries(fields).filter(([name]) => !generatedFields.has(name));

  return entries
    .map(([name, field]) => {
      const required = field.required && field.default === undefined;
      const defaultValue = editing
        ? `{String(editingItem?.entity?.[${JSON.stringify(name)}] ?? editingItem?.[${JSON.stringify(name)}] ?? "")}`
        : JSON.stringify(field.default ?? "");
      if (field.type === "enum" && field.enumName && enums[field.enumName]) {
        const options = (enums[field.enumName] ?? [])
          .map((opt) => `            <option value=${JSON.stringify(opt)}>${escapeText(opt)}</option>`)
          .join("\n");
        return `          <div className="ng-field">
            <label className="ng-label" htmlFor="${name}">${name}${required ? " *" : ""}</label>
            <select className="ng-input" id="${name}" name="${name}" defaultValue=${defaultValue}${required ? " required" : ""}>
              <option value="" disabled>Select ${escapeText(name)}...</option>
${options}
            </select>
          </div>`;
      }
      const type =
        field.type === "number"
          ? "number"
          : field.type === "date"
          ? "date"
          : field.type === "boolean"
          ? "checkbox"
          : "text";

      if (type === "checkbox") {
        return `          <div className="ng-field" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input className="ng-checkbox" id="${name}" name="${name}" type="checkbox" defaultChecked={Boolean(editingItem?.entity?.[${JSON.stringify(name)}] ?? editingItem?.[${JSON.stringify(name)}])} />
            <label className="ng-label" htmlFor="${name}" style={{ margin: 0 }}>${name}</label>
          </div>`;
      }

      return `          <Input
            id="${name}"
            label="${name}${required ? " *" : ""}"
            name="${name}"
            type="${type}"
            defaultValue=${defaultValue}
            ${required ? "required" : ""}
          />`;
    })
    .join("\n");
}

function generateFeatureView(
  group: EntityEndpointsGroup,
  entity: FrontendApiEntity | undefined,
  enums: Readonly<Record<string, readonly string[]>>,
  operationNames: ReadonlyMap<NormalizedEndpointDefinition, string>,
  serverState: "tanstack-query" | "swr" | "native-fetch",
  hasAuth: boolean,
): string {
  const entityName = group.entityName;
  const listOp = group.listEndpoint ? operationNames.get(group.listEndpoint) : undefined;
  const createOp = group.createEndpoint ? operationNames.get(group.createEndpoint) : undefined;
  const updateOp = group.updateEndpoint ? operationNames.get(group.updateEndpoint) : undefined;
  const deleteOp = group.deleteEndpoint ? operationNames.get(group.deleteEndpoint) : undefined;
  const entityFields = entity?.fields ?? {};
  const permissionStart = (action: string) =>
    hasAuth ? `{hasPermission("${entityName.toLowerCase()}:${action}") && (` : "";
  const permissionEnd = hasAuth ? ")}" : "";
  const filterParams = group.listEndpoint?.queryParams ?? [];
  const searchParam = filterParams.find((parameter) => parameter.name === "search");
  const hasPagination = Boolean(group.listEndpoint?.pagination);
  const fields = Object.entries(entityFields);
  const generatedInputTypes = [...new Set([createOp, updateOp, deleteOp].filter(Boolean))];

  const imports: string[] = ['"use client";', ""];
  imports.push(
    'import { useState, type FormEvent } from "react";',
    'import { Button } from "@/components/ui/button";',
    'import { Dialog } from "@/components/ui/dialog";',
    'import { Input } from "@/components/ui/input";',
    'import { Notice } from "@/components/ui/notice";',
    'import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";',
  );

  if (serverState === "tanstack-query") {
    const hookImports: string[] = [];
    if (listOp) hookImports.push(`use${listOp[0]?.toUpperCase()}${listOp.slice(1)}`);
    if (createOp) hookImports.push(`use${createOp[0]?.toUpperCase()}${createOp.slice(1)}`);
    if (updateOp) hookImports.push(`use${updateOp[0]?.toUpperCase()}${updateOp.slice(1)}`);
    if (deleteOp) hookImports.push(`use${deleteOp[0]?.toUpperCase()}${deleteOp.slice(1)}`);
    if (hookImports.length) {
      imports.push(`import { ${hookImports.join(", ")} } from "@/lib/api/hooks";`);
    }
  } else if (serverState === "swr") {
    const hookImports: string[] = [];
    if (listOp) hookImports.push(`use${listOp[0]?.toUpperCase()}${listOp.slice(1)}`);
    if (createOp) hookImports.push(`use${createOp[0]?.toUpperCase()}${createOp.slice(1)}`);
    if (updateOp) hookImports.push(`use${updateOp[0]?.toUpperCase()}${updateOp.slice(1)}`);
    if (deleteOp) hookImports.push(`use${deleteOp[0]?.toUpperCase()}${deleteOp.slice(1)}`);
    if (hookImports.length) {
      imports.push(`import { ${hookImports.join(", ")} } from "@/lib/api/hooks";`);
    }
  } else {
    const apiImports: string[] = [];
    if (listOp) apiImports.push(listOp);
    if (createOp) apiImports.push(createOp);
    if (updateOp) apiImports.push(updateOp);
    if (deleteOp) apiImports.push(deleteOp);
    if (apiImports.length) {
      imports.push(`import { ${apiImports.join(", ")} } from "@/lib/api";`);
      imports.push('import { useCallback, useEffect } from "react";');
    }
  }

  if (hasAuth) {
    imports.push('import { useSessionView } from "@/lib/auth/use-session-view";');
  }
  if (generatedInputTypes.length > 0) {
    imports.push(
      `import type { ${generatedInputTypes.map((operation) => `${operation}Input`).join(", ")} } from "@/lib/api/types";`,
    );
  }

  const queryState = [
    ...(hasPagination ? ['  const [page, setPage] = useState(1);'] : []),
    ...(searchParam ? ['  const [searchFilter, setSearchFilter] = useState("");'] : []),
  ].join("\n");
  const queryFields = [
    ...(hasPagination
      ? [`${JSON.stringify(group.listEndpoint?.pagination?.pageParam ?? "page")}: page`, `${JSON.stringify(group.listEndpoint?.pagination?.pageSizeParam ?? "pageSize")}: ${group.listEndpoint?.pagination?.defaultPageSize ?? 25}`]
      : []),
    ...(searchParam ? [`${JSON.stringify(searchParam.name)}: searchFilter` ] : []),
  ];
  const queryParam = queryFields.length ? `{ query: { ${queryFields.join(", ")} } }` : "{}";

  const hookCalls: string[] = [];
  if (serverState === "tanstack-query") {
    if (listOp) {
      hookCalls.push(`  const { data, isLoading, error } = use${listOp[0]?.toUpperCase()}${listOp.slice(1)}(${queryParam});`);
    }
    if (createOp) {
      hookCalls.push(`  const createMutation = use${createOp[0]?.toUpperCase()}${createOp.slice(1)}();`);
    }
    if (updateOp) {
      hookCalls.push(`  const updateMutation = use${updateOp[0]?.toUpperCase()}${updateOp.slice(1)}();`);
    }
    if (deleteOp) {
      hookCalls.push(`  const deleteMutation = use${deleteOp[0]?.toUpperCase()}${deleteOp.slice(1)}();`);
    }
  } else if (serverState === "swr") {
    if (listOp) {
      hookCalls.push(`  const { data, isLoading, error } = use${listOp[0]?.toUpperCase()}${listOp.slice(1)}(${queryParam});`);
    }
    if (createOp) {
      hookCalls.push(`  const createMutation = use${createOp[0]?.toUpperCase()}${createOp.slice(1)}();`);
    }
    if (updateOp) {
      hookCalls.push(`  const updateMutation = use${updateOp[0]?.toUpperCase()}${updateOp.slice(1)}();`);
    }
    if (deleteOp) {
      hookCalls.push(`  const deleteMutation = use${deleteOp[0]?.toUpperCase()}${deleteOp.slice(1)}();`);
    }
  } else {
    hookCalls.push(
      '  const [data, setData] = useState<unknown>(null);',
      '  const [isLoading, setIsLoading] = useState(false);',
      '  const [error, setError] = useState<Error | null>(null);',
      '  const refetch = useCallback(async () => {',
      '    setIsLoading(true);',
      '    setError(null);',
      '    try {',
      listOp ? `      const res = await ${listOp}(${queryParam});\n      setData(res);` : "      setData([]);",
      '    } catch (err: unknown) {',
      '      setError(err instanceof Error ? err : new Error(String(err)));',
      '    } finally {',
      '      setIsLoading(false);',
      '    }',
      `  }, [${[...(hasPagination ? ["page"] : []), ...(searchParam ? ["searchFilter"] : [])].join(", ")}]);`,
      '  useEffect(() => { void refetch(); }, [refetch]);',
    );
  }

  const itemsAccessor = hasPagination
    ? '  const items = (data as unknown as { items?: readonly FeatureRow[] } | null)?.items ?? (Array.isArray(data) ? data as unknown as readonly FeatureRow[] : []);'
    : '  const items = Array.isArray(data) ? data as unknown as readonly FeatureRow[] : (data as unknown as { items?: readonly FeatureRow[] } | null)?.items ?? [];';

  const tableHeaders = fields
    .slice(0, 5)
    .map(([name]) => `            <TableHeaderCell>${name}</TableHeaderCell>`)
    .join("\n");

  const tableCells = fields
    .slice(0, 5)
    .map(([name]) => `              <TableCell>{String(row.entity ? row.entity[${JSON.stringify(name)}] ?? "" : row[${JSON.stringify(name)}] ?? "")}</TableCell>`)
    .join("\n");

  const createForm = createOp || updateOp
    ? `      <Dialog onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setEditingItem(null); }} open={isCreateOpen} title={editingItem ? "Edit ${entityName}" : "Create ${entityName}"}>
        <form className="ng-form" onSubmit={handleSave}>
          {mutationError ? <Notice tone="alert">{mutationError}</Notice> : null}
${fieldInputs(entityFields, enums, true)}
          <div className="ng-actions" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => { setIsCreateOpen(false); setEditingItem(null); }} type="button" variant="secondary">Cancel</Button>
            <Button disabled={isSubmitting} type="submit">{isSubmitting ? "Saving..." : editingItem ? "Save changes" : "Create"}</Button>
          </div>
        </form>
      </Dialog>`
    : "";

  const deleteDialog = deleteOp
    ? `      <Dialog onOpenChange={(open) => !open && setDeletingItem(null)} open={Boolean(deletingItem)} title="Delete ${entityName}">
        <div>
          <p>Are you sure you want to delete this record? This action cannot be undone.</p>
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
            <Button onClick={() => setPage((p) => p + 1)} type="button" variant="secondary">Next</Button>
          </div>
        </div>`
    : "";

  return source([
    ...imports,
    "",
    'type FeatureRow = { readonly id?: unknown; readonly entity?: Readonly<Record<string, unknown>>; readonly [key: string]: unknown };',
    "",
    `export function ${entityName}FeatureScreen() {`,
    queryState,
    '  const [isCreateOpen, setIsCreateOpen] = useState(false);',
    '  const [editingItem, setEditingItem] = useState<FeatureRow | null>(null);',
    '  const [deletingItem, setDeletingItem] = useState<FeatureRow | null>(null);',
    '  const [mutationError, setMutationError] = useState<string | null>(null);',
    '  const [isSubmitting, setIsSubmitting] = useState(false);',
    hasAuth ? '  const { hasPermission } = useSessionView();' : "",
    "",
    ...hookCalls,
    "",
    itemsAccessor,
    "",
    '  const handleSave = async (e: FormEvent<HTMLFormElement>) => {',
    '    e.preventDefault();',
    '    setMutationError(null);',
    '    setIsSubmitting(true);',
    '    const form = new FormData(e.currentTarget);',
    '    const body: Record<string, unknown> = {};',
    ...Object.entries(entityFields)
      .filter(([name]) => !["id", "createdAt", "updatedAt", "isDeleted", "deletedAt"].includes(name))
      .flatMap(([name, field]) => field.type === "boolean"
        ? [`    body[${JSON.stringify(name)}] = form.has(${JSON.stringify(name)});`]
        : field.type === "number"
        ? [`    const ${name}Value = form.get(${JSON.stringify(name)});`, `    if (${name}Value !== null && ${name}Value !== "") body[${JSON.stringify(name)}] = Number(${name}Value);`]
        : [`    const ${name}Value = form.get(${JSON.stringify(name)});`, `    if (${name}Value !== null && ${name}Value !== "") body[${JSON.stringify(name)}] = String(${name}Value);`]),
    '    try {',
    '      if (editingItem) {',
    updateOp
      ? serverState === "tanstack-query"
        ? `        const id = editingItem.id ?? editingItem.entity?.id; await updateMutation.mutateAsync({ path: { ${JSON.stringify(group.updateEndpoint?.pathParams[0]?.name ?? "id")}: id }, body } as unknown as ${updateOp}Input);`
        : serverState === "swr"
        ? `        const id = editingItem.id ?? editingItem.entity?.id; await updateMutation.trigger({ path: { ${JSON.stringify(group.updateEndpoint?.pathParams[0]?.name ?? "id")}: id }, body } as unknown as ${updateOp}Input);`
        : `        const id = editingItem.id ?? editingItem.entity?.id; await ${updateOp}({ path: { ${JSON.stringify(group.updateEndpoint?.pathParams[0]?.name ?? "id")}: id }, body } as unknown as ${updateOp}Input); await refetch();`
      : '        throw new Error("This entity has no update endpoint.");',
    '      } else {',
    createOp
      ? serverState === "tanstack-query"
        ? `        await createMutation.mutateAsync({ body } as unknown as ${createOp}Input);`
        : serverState === "swr"
        ? `        await createMutation.trigger({ body } as unknown as ${createOp}Input);`
        : `        await ${createOp}({ body } as unknown as ${createOp}Input); await refetch();`
      : '        throw new Error("This entity has no create endpoint.");',
    '      }',
    '      setIsCreateOpen(false);',
    '      setEditingItem(null);',
    '    } catch (err: unknown) {',
    '      setMutationError(err instanceof Error ? err.message : String(err));',
    '    } finally {',
    '      setIsSubmitting(false);',
    '    }',
    '  };',
    "",
    '  const handleDelete = async () => {',
    '    if (!deletingItem) return;',
    '    setMutationError(null);',
    '    setIsSubmitting(true);',
    '    const id = deletingItem.id ?? deletingItem.entity?.id;',
    '    try {',
    serverState === "tanstack-query" && deleteOp
      ? `      await deleteMutation.mutateAsync({ path: { ${JSON.stringify(group.deleteEndpoint?.pathParams[0]?.name ?? "id")}: id } } as unknown as ${deleteOp}Input);`
      : serverState === "swr" && deleteOp
      ? `      await deleteMutation.trigger({ path: { ${JSON.stringify(group.deleteEndpoint?.pathParams[0]?.name ?? "id")}: id } } as unknown as ${deleteOp}Input);`
      : deleteOp
      ? `      await ${deleteOp}({ path: { ${JSON.stringify(group.deleteEndpoint?.pathParams[0]?.name ?? "id")}: id } } as unknown as ${deleteOp}Input); await refetch();`
      : '      // No delete endpoint',
    '      setDeletingItem(null);',
    '    } catch (err: unknown) {',
    '      setMutationError(err instanceof Error ? err.message : String(err));',
    '    } finally {',
    '      setIsSubmitting(false);',
    '    }',
    '  };',
    "",
    '  return (',
    '    <div className="ng-feature-screen" style={{ display: "grid", gap: "24px" }}>',
    '      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>',
    '        <div>',
    `          <h2 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>${entityName} Management</h2>`,
    `          <p style={{ margin: "4px 0 0", color: "var(--ng-muted)" }}>Explore, filter and manage ${entityName} records.</p>`,
    '        </div>',
    createOp
      ? `        ${permissionStart("create")}<Button onClick={() => { setEditingItem(null); setIsCreateOpen(true); }} type="button">+ New ${entityName}</Button>${permissionEnd}`
      : "",
    '      </div>',
    "",
    '      {error ? <Notice tone="alert">{error.message ?? "Failed to load records"}</Notice> : null}',
    "",
    '      <div className="ng-panel" style={{ padding: "16px" }}>',
        ...(searchParam
          ? [
              '        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>',
              '          <Input id="search-filter" label="Filter records" onChange={(e) => setSearchFilter(e.target.value)} placeholder="Type to filter..." value={searchFilter} />',
              "        </div>",
            ]
          : []),
    "",
    '        {isLoading ? (',
    '          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ng-muted)" }}>Loading records...</div>',
    '        ) : items.length === 0 ? (',
    '          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ng-muted)" }}>No records found.</div>',
    '        ) : (',
    '          <Table>',
    '            <TableHead>',
    '              <TableRow>',
    tableHeaders,
    updateOp || deleteOp ? '                <TableHeaderCell>Actions</TableHeaderCell>' : "",
    '              </TableRow>',
    '            </TableHead>',
    '            <TableBody>',
    '              {items.map((row: FeatureRow, idx: number) => {',
    '                const rawKey = row.entity?.id ?? row.id;',
    '                const itemKey = typeof rawKey === "string" || typeof rawKey === "number" ? rawKey : idx;',
    '                return (',
    '                  <TableRow key={itemKey}>',
    tableCells,
    updateOp || deleteOp
      ? `                    <TableCell>
                      ${updateOp ? `${permissionStart("update")}<Button onClick={() => { setEditingItem(row); setMutationError(null); setIsCreateOpen(true); }} type="button" variant="secondary">Edit</Button>${permissionEnd}` : ""}
                      ${deleteOp ? `${permissionStart("delete")}<Button onClick={() => setDeletingItem(row)} type="button" variant="danger">Delete</Button>${permissionEnd}` : ""}
                    </TableCell>`
      : "",
    '                  </TableRow>',
    '                );',
    '              })}',
    '            </TableBody>',
    '          </Table>',
    '        )}',
    paginationControls,
    '      </div>',
    "",
    createForm,
    deleteDialog,
    '    </div>',
    '  );',
    '}',
  ]);
}

export function generateFeatureScreenFiles(
  context: FrontendPluginContributionContext,
): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const endpoints = context.api.endpoints;
  if (!endpoints || endpoints.length === 0) return [];

  const groups = groupEndpointsByEntity(endpoints);
  const operationNames = getFrontendOperationNames(endpoints);
  const serverState =
    typeof context.frontend.stateManagement === "object" &&
    context.frontend.stateManagement.generateHooks
      ? (context.frontend.stateManagement.server as "tanstack-query" | "swr" | "native-fetch")
      : "native-fetch";
  const hasAuth = Boolean(context.api.authentication);

  const files: GeneratedFile[] = [];

  for (const [entityName, group] of groups.entries()) {
    const slug = slugify(entityName);
    const entity = context.api.entities[entityName];
    const screenContent = generateFeatureView(
      group,
      entity,
      context.api.enums,
      operationNames,
      serverState,
      hasAuth,
    );

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
        '  return (',
        '    <main className="ng-shell" style={{ padding: "40px 5vw" }}>',
        `      <${entityName}FeatureScreen />`,
        '    </main>',
        '  );',
        '}',
      ]),
    });
  }

  return files;
}

export const featureScreensFrontendPlugin: FrontendGeneratorPlugin = {
  descriptor: {
    id: "feature-screens",
    version: "1.0.0",
    role: "feature-screens",
    provides: ["frontend:entity-management-screens"],
    requires: [
      { capability: "api:typed-fetch-client" },
      { capability: "ui:accessible-primitives" },
    ],
  },
  contribute: generateFeatureScreenFiles,
};
