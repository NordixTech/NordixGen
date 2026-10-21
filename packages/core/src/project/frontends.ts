import type { FrontendDefinition, NordixConfig } from "../configuration/schema.js";
import { scopedOperationName } from "../configuration/validation/shared.js";
import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import { dictionary, sortedRecord } from "./fields.js";
import { resolveTheme } from "./theme.js";
import type {
  ConfigurationOrigin,
  ResolvedBackend,
  ResolvedEntity,
  ResolvedField,
  ResolvedFrontend,
  ResolvedInput,
  ResolvedOperation,
  TransportField,
  TransportInput,
  TransportOperation,
} from "./types.js";

export function transportField(field: ResolvedField): TransportField {
  const { column: _column, origin: _origin, value, ...definition } = field;
  const { applicationType: _applicationType, ...transport } = value;
  return {
    ...definition,
    ...(field.defaultValue.kind === "clock" ? { default: undefined } : {}),
    value: transport,
  };
}
function transportInput(input: ResolvedInput): TransportInput {
  const { binding: _binding, origin: _origin, definition, ...value } = input;
  return { ...value, definition: transportField(definition) };
}
export function transportOperation(operation: ResolvedOperation): TransportOperation {
  const fields = (input: Readonly<Record<string, ResolvedField>>) =>
    dictionary(Object.entries(input).map(([name, field]) => [name, transportField(field)]));
  const parameter = (p: ResolvedOperation["queryParams"][number]) => ({
    name: p.name,
    required: p.required,
    ...(p.input.binding
      ? { field: { entity: p.input.binding.entity, field: p.input.binding.field } }
      : {}),
    type: p.definition.type,
    ...(p.definition.type === "enum" ? { enumName: p.definition.enumName } : {}),
    ...(p.operator ? { operator: p.operator } : {}),
    definition: transportField(p.definition),
    input: transportInput(p.input),
  });
  const joins = operation.joins.map((j) => ({
    entity: j.entity,
    type: j.type,
    fields: j.fields,
    projection: fields(j.projection),
    cardinality: j.cardinality,
    nullable: j.nullable,
  }));
  const pagination = operation.pagination;
  return {
    id: operation.id,
    moduleId: operation.moduleId,
    operationId: operation.operationId,
    backend: operation.backend,
    entity: operation.entity,
    action: operation.action,
    recordIdParameter: operation.pathParams.find(
      (p) => p.input.binding?.entityId === operation.entityId && p.input.binding.field === "id",
    )?.name,
    invalidates: [],
    method: operation.method,
    path: operation.path,
    ...(operation.summary === undefined ? {} : { summary: operation.summary }),
    authRequired: operation.authRequired,
    roles: operation.roles,
    permissions: operation.permissions,
    pathParams: operation.pathParams.map(parameter),
    queryParams: operation.queryParams.map(parameter),
    joins,
    ...(pagination
      ? {
          pagination: {
            strategy: pagination.strategy,
            pageParam: pagination.pageParam,
            pageSizeParam: pagination.pageSizeParam,
            defaultPageSize: pagination.defaultPageSize,
            maxPageSize: pagination.maxPageSize,
          },
        }
      : {}),
    body: {
      kind: operation.body.kind,
      fields: dictionary(
        Object.entries(operation.body.fields).map(([name, input]) => [name, transportInput(input)]),
      ),
    },
    input: dictionary(
      Object.entries(operation.input).map(([name, input]) => [name, transportInput(input)]),
    ),
    response: {
      kind: operation.response.kind,
      entity: fields(operation.response.entity),
      joins,
      status: operation.response.status,
    },
  };
}
export function resolveFrontend(
  frontend: FrontendDefinition,
  config: NordixConfig,
  backends: Readonly<Record<string, ResolvedBackend>>,
  entities: Readonly<Record<string, ResolvedEntity>>,
  operations: readonly ResolvedOperation[],
  origin: ConfigurationOrigin,
  diagnose: (diagnostic: ConfigDiagnostic) => void,
): ResolvedFrontend {
  const visible = operations.filter((operation) => frontend.connectsTo.includes(operation.backend));
  const authorities = frontend.connectsTo.flatMap((name) =>
    backends[name].identity ? [backends[name].identity] : [],
  );
  const identity = frontend.access.backend
    ? backends[frontend.access.backend].identity
    : authorities.length === 1
      ? authorities[0]
      : undefined;
  const endpoints = visible.map((operation) => ({
    ...transportOperation(operation),
    invalidates: [
      ...new Set([
        ...visible
          .filter(
            (query) =>
              query.method === "GET" &&
              query.backend === operation.backend &&
              (query.entity === operation.entity ||
                query.joins.some((join) => join.entity === operation.entity)),
          )
          .map((query) => query.id),
      ]),
    ].sort(),
  }));
  const features: Record<
    string,
    {
      list?: string;
      get?: string;
      create?: string;
      update?: string;
      delete?: string;
      custom: string[];
    }
  > = Object.create(null);
  for (const operation of visible) {
    const group = features[operation.entity] ?? { custom: [] };
    features[operation.entity] = group;
    const slot =
      operation.action === "query"
        ? operation.pathParams.length
          ? "get"
          : "list"
        : operation.action === "custom"
          ? undefined
          : operation.action;
    if (!slot) {
      group.custom.push(operation.id);
      continue;
    }
    const recordMutation = slot === "update" || slot === "delete";
    const recordId = operation.pathParams.find(
      (parameter) =>
        parameter.input.binding?.entityId === operation.entityId &&
        parameter.input.binding.field === "id",
    );
    const needsBinding =
      operation.queryParams.some((parameter) => parameter.required) ||
      (recordMutation
        ? operation.pathParams.length !== 1 || !recordId
        : slot === "create" && operation.pathParams.length > 0);
    const candidates = visible.filter(
      (candidate) =>
        candidate.entity === operation.entity &&
        candidate.action === operation.action &&
        (candidate.action !== "query" ||
          Boolean(candidate.pathParams.length) === Boolean(operation.pathParams.length)),
    );
    if (needsBinding || candidates.length > 1) {
      group.custom.push(operation.id);
      diagnose({
        ...createDiagnostic(
          needsBinding ? "FRONTEND_SCREEN_BINDING_REQUIRED" : "FRONTEND_SCREEN_OPERATION_AMBIGUOUS",
          origin.path,
          needsBinding
            ? `Operation "${operation.id}" requires explicit path/query inputs that the automatic ${slot} screen cannot supply. Use its typed client/API Explorer; no action or guessed binding is generated.`
            : `Entity "${operation.entity}" has multiple ${slot} operations (${candidates.map((candidate) => candidate.id).join(", ")}). Use their typed clients/API Explorer; the ambiguous automatic screen action is omitted.`,
          "warning",
        ),
        ...(origin.source ? { source: origin.source } : {}),
      });
    } else group[slot] = operation.id;
  }
  const names = dictionary(
    visible.map((operation) => [
      operation.id,
      scopedOperationName(
        operation.backend,
        operation.operationId,
        visible.filter((other) => other.operationId === operation.operationId).length > 1,
      ),
    ]),
  );
  const inventory = new Set(["/"]);
  if (frontend.ai?.enabled) {
    if (frontend.ai.chat.enabled && frontend.ai.chat.placement === "page") inventory.add("/chat");
    if (frontend.ai.connectPortal.enabled) inventory.add("/connect-ai");
  }
  if (visible.length) inventory.add("/api-explorer");
  for (const operation of visible) inventory.add(entities[operation.entity].page);
  if (identity) {
    inventory.add("/admin/roles");
    inventory.add("/sign-in");
    inventory.add("/sign-up");
    if (identity.methods.includes("email-password")) {
      inventory.add("/forgot-password");
      inventory.add("/reset-password");
    }
    inventory.add("/profile");
  }
  const publicPage = (path: string) =>
    frontend.access.mode === "public" ||
    path === "/sign-in" ||
    path === "/sign-up" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    (frontend.access.mode === "mixed" &&
      (frontend.access.publicRoutes ?? []).some((pattern) =>
        pattern.endsWith("/**")
          ? path === pattern.slice(0, -3) || path.startsWith(`${pattern.slice(0, -3)}/`)
          : pattern === path,
      ));
  return {
    name: frontend.name,
    ...(frontend.ai?.enabled
      ? {
          ai: {
            ...frontend.ai,
            authMethods: backends[frontend.ai.backend].ai?.mcp.authMethods ?? [],
          },
        }
      : {}),
    theme: resolveTheme(frontend.theme),
    repository: config.repositories.find(
      (r) => r.name === frontend.repository,
    ) as NordixConfig["repositories"][number],
    path: frontend.path,
    connections: [...frontend.connectsTo].sort(),
    ...(identity ? { identity } : {}),
    access: { ...frontend.access, ...(identity ? { backend: identity.backend } : {}) },
    pages: [...inventory].sort().map((path) => ({
      path,
      authenticated:
        (frontend.ai?.enabled && (path === "/chat" || path === "/connect-ai")) ||
        path === "/admin/roles" ||
        path === "/profile" ||
        !publicPage(path),
    })),
    operations: visible.map((operation) => operation.id),
    operationNames: names,
    endpoints,
    features: sortedRecord(Object.entries(features)),
    entities: sortedRecord(
      [...new Set(visible.map((operation) => operation.entity))].map((name) => [
        name,
        {
          fields: dictionary(
            Object.entries(entities[name].fields).map(([key, field]) => [
              key,
              transportField(field),
            ]),
          ),
          softDelete: entities[name].softDelete,
        },
      ]),
    ),
    origin,
  };
}
