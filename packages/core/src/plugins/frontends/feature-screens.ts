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

function endpointBodyFields(
  endpoint: NormalizedEndpointDefinition | undefined,
  entities: Readonly<Record<string, FrontendApiEntity>>,
): Readonly<Record<string, FieldDefinition>> {
  if (!endpoint?.requestBody) return {};
  const useCase = (
    endpoint.requestBody as { useCase?: { entity: string; operation: "create" | "update" } }
  ).useCase;
  if (useCase) {
    return Object.fromEntries(
      Object.entries(entities[useCase.entity]?.fields ?? {})
        .filter(
          ([name]) => !["id", "createdAt", "updatedAt", "isDeleted", "deletedAt"].includes(name),
        )
        .map(([name, field]) => [
          name,
          {
            ...field,
            required:
              useCase.operation === "create" && field.required && field.default === undefined,
          },
        ]),
    );
  }
  return Object.fromEntries(
    Object.entries(endpoint.requestBody).flatMap(([name, definition]) => {
      const descriptor = definition as {
        field?: { entity: string; field: string };
        required?: boolean;
      };
      const field = descriptor.field
        ? entities[descriptor.field.entity]?.fields[descriptor.field.field]
        : (definition as FieldDefinition);
      if (!field)
        return [
          [name, { type: "json", required: descriptor.required ?? false } as FieldDefinition],
        ];
      return [[name, { ...field, required: descriptor.required ?? field.required }]];
    }),
  );
}

function zodField(
  field: FieldDefinition,
  enums: Readonly<Record<string, readonly string[]>>,
): string {
  const required = field.required && field.default === undefined;
  let schema: string;
  switch (field.type) {
    case "number":
      schema = `z.preprocess((value) => value === "" || Number.isNaN(value) ? undefined : value, z.number()${required ? "" : ".optional()"})`;
      break;
    case "boolean":
      schema = "z.boolean()";
      break;
    case "enum": {
      const values = enums[field.enumName ?? ""] ?? [];
      schema = values.length
        ? `z.enum([${values.map((value) => JSON.stringify(value)).join(", ")}])`
        : "z.string()";
      break;
    }
    case "json":
      schema = required ? "z.unknown()" : "z.unknown().optional()";
      break;
    default:
      schema = `z.string()${required ? '.min(1, "Required")' : ".optional()"}`;
  }
  if (field.default !== undefined) schema += `.default(${JSON.stringify(field.default)})`;
  return schema;
}

function bodySchemaSource(
  endpoint: NormalizedEndpointDefinition | undefined,
  fallbackFields: Readonly<Record<string, FieldDefinition>>,
  entities: Readonly<Record<string, FrontendApiEntity>>,
  enums: Readonly<Record<string, readonly string[]>>,
): string {
  const fields = endpoint ? endpointBodyFields(endpoint, entities) : fallbackFields;
  const entries = Object.entries(fields).map(
    ([name, field]) => `  ${JSON.stringify(name)}: ${zodField(field, enums)},`,
  );
  return `z.object({\n${entries.join("\n")}\n})`;
}

export function groupEndpointsByEntity(
  endpoints: readonly NormalizedEndpointDefinition[],
): ReadonlyMap<string, EntityEndpointsGroup> {
  const groups = new Map<
    string,
    {
      entityName: string;
      listEndpoint?: NormalizedEndpointDefinition;
      getEndpoint?: NormalizedEndpointDefinition;
      createEndpoint?: NormalizedEndpointDefinition;
      updateEndpoint?: NormalizedEndpointDefinition;
      deleteEndpoint?: NormalizedEndpointDefinition;
      customEndpoints: NormalizedEndpointDefinition[];
    }
  >();

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
    } else if (
      (endpoint.method === "PATCH" || endpoint.method === "PUT") &&
      !group.updateEndpoint
    ) {
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
): string {
  const generatedFields = new Set(["id", "createdAt", "updatedAt", "isDeleted", "deletedAt"]);
  const entries = Object.entries(fields).filter(([name]) => !generatedFields.has(name));

  return entries
    .map(([name, field]) => {
      const required = field.required && field.default === undefined;
      const defaultValue = `{String(editingItem?.entity?.[${JSON.stringify(name)}] ?? editingItem?.[${JSON.stringify(name)}] ?? "")}`;
      if (field.type === "enum" && field.enumName && enums[field.enumName]) {
        const options = enums[field.enumName]
          .map(
            (opt) => `            <option value=${JSON.stringify(opt)}>${escapeText(opt)}</option>`,
          )
          .join("\n");
        return `          <div className="ng-field">
            <label className="ng-label" htmlFor="${name}">${name}${required ? " *" : ""}</label>
            <select className="ng-input" id="${name}" defaultValue=${defaultValue}{...featureForm.register(${JSON.stringify(name)})}>
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
            <input className="ng-checkbox" id="${name}" type="checkbox" {...featureForm.register(${JSON.stringify(name)})} />
            <label className="ng-label" htmlFor="${name}" style={{ margin: 0 }}>${name}</label>
          </div>`;
      }

      return `          <Input
            id="${name}"
            label="${name}${required ? " *" : ""}"
            type="${type}"
            defaultValue=${defaultValue}
            {...featureForm.register(${JSON.stringify(name)}${field.type === "number" ? ", { valueAsNumber: true }" : ""})}
            error={featureForm.formState.errors[${JSON.stringify(name)}]?.message as string | undefined}
          />`;
    })
    .join("\n");
}

function generateFeatureView(
  group: EntityEndpointsGroup,
  entity: FrontendApiEntity | undefined,
  entities: Readonly<Record<string, FrontendApiEntity>>,
  enums: Readonly<Record<string, readonly string[]>>,
  operationNames: ReadonlyMap<NormalizedEndpointDefinition, string>,
  serverState: "tanstack-query" | "swr" | "native-fetch",
  hasAuth: boolean,
): string {
  const entityName = group.entityName;
  const listOp = group.listEndpoint ? operationNames.get(group.listEndpoint) : undefined;
  const createOp = group.createEndpoint?.requestBody
    ? operationNames.get(group.createEndpoint)
    : undefined;
  const updateOp = group.updateEndpoint?.requestBody
    ? operationNames.get(group.updateEndpoint)
    : undefined;
  const deleteOp = group.deleteEndpoint ? operationNames.get(group.deleteEndpoint) : undefined;
  const updatePathParam = group.updateEndpoint?.pathParams[0]?.name ?? "id";
  const deletePathParam = group.deleteEndpoint?.pathParams[0]?.name ?? "id";
  const entityFields = entity?.fields ?? {};
  const deleteMessage =
    entity?.softDelete === "boolean"
      ? "This record will be marked inactive and hidden from active lists."
      : entity?.softDelete === "timestamp"
        ? "This record will be archived using the backend soft-delete policy."
        : "This action permanently removes this record.";
  const bodyFields = {
    ...endpointBodyFields(createOp ? group.createEndpoint : undefined, entities),
    ...endpointBodyFields(updateOp ? group.updateEndpoint : undefined, entities),
  };
  const formFields = Object.keys(bodyFields).length ? bodyFields : entityFields;
  const permissionStart = (endpoint: NormalizedEndpointDefinition | undefined) => {
    if (!hasAuth || !endpoint || (!endpoint.roles.length && !endpoint.permissions.length))
      return "";
    const roleCheck = endpoint.roles.length
      ? `(${JSON.stringify(endpoint.roles)} as readonly string[]).some((role) => hasRole(role))`
      : "true";
    const permissionCheck = endpoint.permissions.length
      ? `(${JSON.stringify(endpoint.permissions)} as readonly string[]).every((permission) => hasPermission(permission))`
      : "true";
    return `{${roleCheck} && ${permissionCheck} && (`;
  };
  const permissionEnd = (endpoint: NormalizedEndpointDefinition | undefined) =>
    permissionStart(endpoint) ? ")}" : "";
  const filterParams = group.listEndpoint?.queryParams ?? [];
  const searchParam = filterParams.find((parameter) => parameter.name === "search");
  const hasPagination = Boolean(group.listEndpoint?.pagination);
  const fields = Object.entries(entityFields);
  const generatedInputTypes = [...new Set([createOp, updateOp, deleteOp].filter(Boolean))];

  const imports: string[] = ['"use client";', ""];
  imports.push(
    'import { useState } from "react";',
    'import { useForm } from "react-hook-form";',
    'import { zodResolver } from "@hookform/resolvers/zod";',
    'import { z } from "zod";',
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
    ...(hasPagination ? ["  const [page, setPage] = useState(1);"] : []),
    ...(searchParam ? ['  const [searchFilter, setSearchFilter] = useState("");'] : []),
  ].join("\n");
  const queryFields = [
    ...(hasPagination
      ? [
          `${JSON.stringify(group.listEndpoint?.pagination?.pageParam ?? "page")}: page`,
          `${JSON.stringify(group.listEndpoint?.pagination?.pageSizeParam ?? "pageSize")}: ${group.listEndpoint?.pagination?.defaultPageSize ?? 25}`,
        ]
      : []),
    ...(searchParam ? [`${JSON.stringify(searchParam.name)}: searchFilter`] : []),
  ];
  const queryParam = queryFields.length ? `{ query: { ${queryFields.join(", ")} } }` : "{}";

  const hookCalls: string[] = [];
  if (serverState === "tanstack-query") {
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
  } else if (serverState === "swr") {
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
  } else {
    hookCalls.push(
      "  const [data, setData] = useState<unknown>(null);",
      "  const [isLoading, setIsLoading] = useState(false);",
      "  const [error, setError] = useState<Error | null>(null);",
      "  const refetch = useCallback(async () => {",
      "    setIsLoading(true);",
      "    setError(null);",
      "    try {",
      listOp
        ? `      const res = await ${listOp}(${queryParam});\n      setData(res);`
        : "      setData([]);",
      "    } catch (err: unknown) {",
      "      setError(err instanceof Error ? err : new Error(String(err)));",
      "    } finally {",
      "      setIsLoading(false);",
      "    }",
      `  }, [${[...(hasPagination ? ["page"] : []), ...(searchParam ? ["searchFilter"] : [])].join(", ")}]);`,
      "  useEffect(() => { void refetch(); }, [refetch]);",
    );
  }

  const itemsAccessor = hasPagination
    ? "  const items = (data as unknown as { items?: readonly FeatureRow[] } | null)?.items ?? (Array.isArray(data) ? data as unknown as readonly FeatureRow[] : []);"
    : "  const items = Array.isArray(data) ? data as unknown as readonly FeatureRow[] : (data as unknown as { items?: readonly FeatureRow[] } | null)?.items ?? [];";

  const tableHeaders = fields
    .slice(0, 5)
    .map(([name]) => `            <TableHeaderCell>${name}</TableHeaderCell>`)
    .join("\n");

  const tableCells = fields
    .slice(0, 5)
    .map(
      ([name]) =>
        `              <TableCell>{String(row.entity ? row.entity[${JSON.stringify(name)}] ?? "" : row[${JSON.stringify(name)}] ?? "")}</TableCell>`,
    )
    .join("\n");

  const createForm =
    createOp || updateOp
      ? `      <Dialog onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setEditingItem(null); }} open={isCreateOpen} title={editingItem ? "Edit ${entityName}" : "Create ${entityName}"}>
        <form className="ng-form" onSubmit={featureForm.handleSubmit(handleSave)}>
          {mutationError ? <Notice tone="alert">{mutationError}</Notice> : null}
${fieldInputs(formFields, enums)}
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
            <Button onClick={() => setPage((p) => p + 1)} type="button" variant="secondary">Next</Button>
          </div>
        </div>`
    : "";

  return source([
    ...imports,
    "",
    "type FeatureRow = { readonly id?: unknown; readonly entity?: Readonly<Record<string, unknown>>; readonly [key: string]: unknown };",
    "",
    `export function ${entityName}FeatureScreen() {`,
    `  const createSchema = ${bodySchemaSource(createOp ? group.createEndpoint : undefined, formFields, entities, enums)};`,
    `  const updateSchema = ${bodySchemaSource(updateOp ? group.updateEndpoint : undefined, formFields, entities, enums)};`,
    queryState,
    "  const [isCreateOpen, setIsCreateOpen] = useState(false);",
    "  const [editingItem, setEditingItem] = useState<FeatureRow | null>(null);",
    "  const [deletingItem, setDeletingItem] = useState<FeatureRow | null>(null);",
    "  const [mutationError, setMutationError] = useState<string | null>(null);",
    "  const [isSubmitting, setIsSubmitting] = useState(false);",
    "  const featureForm = useForm<Record<string, unknown>>({ resolver: zodResolver(editingItem ? updateSchema : createSchema) as never });",
    hasAuth ? "  const { hasPermission, hasRole } = useSessionView();" : "",
    "",
    ...hookCalls,
    "",
    itemsAccessor,
    "",
    "  const handleSave = async (body: Record<string, unknown>) => {",
    "    setMutationError(null);",
    "    setIsSubmitting(true);",
    "    try {",
    "      if (editingItem) {",
    updateOp
      ? serverState === "tanstack-query"
        ? `        const id = editingItem.id ?? editingItem.entity?.id; await updateMutation.mutateAsync({ path: { ${JSON.stringify(updatePathParam)}: id }, body } as unknown as ${updateOp}Input);`
        : serverState === "swr"
          ? `        const id = editingItem.id ?? editingItem.entity?.id; await updateMutation.trigger({ path: { ${JSON.stringify(updatePathParam)}: id }, body } as unknown as ${updateOp}Input);`
          : `        const id = editingItem.id ?? editingItem.entity?.id; await ${updateOp}({ path: { ${JSON.stringify(updatePathParam)}: id }, body } as unknown as ${updateOp}Input); await refetch();`
      : '        throw new Error("This entity has no update endpoint.");',
    "      } else {",
    createOp
      ? serverState === "tanstack-query"
        ? `        await createMutation.mutateAsync({ body } as unknown as ${createOp}Input);`
        : serverState === "swr"
          ? `        await createMutation.trigger({ body } as unknown as ${createOp}Input);`
          : `        await ${createOp}({ body } as unknown as ${createOp}Input); await refetch();`
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
    "    const id = deletingItem.id ?? deletingItem.entity?.id;",
    "    try {",
    serverState === "tanstack-query" && deleteOp
      ? `      await deleteMutation.mutateAsync({ path: { ${JSON.stringify(deletePathParam)}: id } } as unknown as ${deleteOp}Input);`
      : serverState === "swr" && deleteOp
        ? `      await deleteMutation.trigger({ path: { ${JSON.stringify(deletePathParam)}: id } } as unknown as ${deleteOp}Input);`
        : deleteOp
          ? `      await ${deleteOp}({ path: { ${JSON.stringify(deletePathParam)}: id } } as unknown as ${deleteOp}Input); await refetch();`
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
      ? `        ${permissionStart(group.createEndpoint)}<Button onClick={() => { setEditingItem(null); featureForm.reset({}); setIsCreateOpen(true); }} type="button">+ New ${entityName}</Button>${permissionEnd(group.createEndpoint)}`
      : "",
    "      </div>",
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
    "        {isLoading ? (",
    '          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ng-muted)" }}>Loading records...</div>',
    "        ) : items.length === 0 ? (",
    '          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ng-muted)" }}>No records found.</div>',
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
    "                const rawKey = row.entity?.id ?? row.id;",
    '                const itemKey = typeof rawKey === "string" || typeof rawKey === "number" ? rawKey : idx;',
    "                return (",
    "                  <TableRow key={itemKey}>",
    tableCells,
    updateOp || deleteOp
      ? `                    <TableCell>
                      ${updateOp ? `${permissionStart(group.updateEndpoint)}<Button onClick={() => { featureForm.reset((row.entity ?? row) as Record<string, unknown>); setEditingItem(row); setMutationError(null); setIsCreateOpen(true); }} type="button" variant="secondary">Edit</Button>${permissionEnd(group.updateEndpoint)}` : ""}
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
      context.api.entities,
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
    dependencies: {
      "@hookform/resolvers": "^5.2.2",
      "react-hook-form": "^7.62.0",
      zod: "^3.24.2",
    },
  },
  contribute: generateFeatureScreenFiles,
};
