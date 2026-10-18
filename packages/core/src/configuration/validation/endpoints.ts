import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import { type FieldDefinition, type NordixConfig, effectiveAuthorization } from "../schema.js";
import { validateField } from "./entities.js";
import {
  fieldDefinitions,
  moduleOwners,
  portableSegment,
  reservedSymbol,
  routePath,
  sameOwner,
} from "./shared.js";

export function validateEndpoints(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const add = (code: string, path: string, message: string) =>
    diagnostics.push(createDiagnostic(code, path, message));
  const owners = moduleOwners(config);
  const routes = new Map<string, string>();
  const operations = new Set<string>();
  const symbols = new Map<string, string>();
  for (const [index, endpoint] of config.endpoints.entries()) {
    const path = `endpoints[${index}]`;
    const backend = config.backends.find((b) => b.name === endpoint.backend);
    const entity = config.entities[endpoint.entity];
    if (!backend)
      add(
        "UNKNOWN_ENDPOINT_BACKEND",
        `${path}.backend`,
        `Backend "${endpoint.backend}" does not exist. Declare it or correct this endpoint reference.`,
      );
    if (!entity)
      add(
        "UNKNOWN_ENDPOINT_ENTITY",
        `${path}.entity`,
        `Entity "${endpoint.entity}" does not exist. Declare it or correct this reference.`,
      );
    else if (entity.backend !== endpoint.backend)
      add(
        "ENDPOINT_ENTITY_BACKEND_MISMATCH",
        `${path}.entity`,
        `Entity "${endpoint.entity}" belongs to "${entity.backend}", not "${endpoint.backend}". Use an entity owned by this backend.`,
      );
    if (!routePath(endpoint.path, true))
      add(
        "ENDPOINT_PATH_INVALID",
        `${path}.path`,
        "Use a canonical absolute route with whole-segment {parameter} placeholders; remove encoded, repeated, dot or trailing segments.",
      );
    const routeKey = `${endpoint.backend}:${endpoint.method}:${endpoint.path.replace(/\{[^{}]+\}/g, "{}")}`;
    if (routes.has(routeKey))
      add(
        "DUPLICATE_ENDPOINT",
        `${path}.path`,
        `Method/path conflicts with ${routes.get(routeKey)} in backend "${endpoint.backend}". Remove or change the duplicate route.`,
      );
    routes.set(routeKey, path);
    const operationKey = `${endpoint.backend}:${endpoint.operationId}`;
    if (operations.has(operationKey))
      add(
        "DUPLICATE_OPERATION_ID",
        `${path}.operationId`,
        `Operation "${endpoint.operationId}" is already used in backend "${endpoint.backend}". Choose a backend-unique operationId.`,
      );
    operations.add(operationKey);
    const symbol = `${endpoint.backend}:${endpoint.operationId.toLowerCase()}`;
    const previousSymbol = symbols.get(symbol);
    if (
      (previousSymbol && previousSymbol !== endpoint.operationId) ||
      reservedSymbol(endpoint.operationId) ||
      !portableSegment(endpoint.operationId)
    )
      add(
        "GENERATED_NAME_COLLISION",
        `${path}.operationId`,
        `Operation "${endpoint.operationId}" conflicts with a reserved symbol/path or "${previousSymbol ?? endpoint.operationId}" after case-insensitive normalization. Choose a distinct safe operationId.`,
      );
    symbols.set(symbol, endpoint.operationId);
    if (
      endpoint.path === "/health" ||
      (backend?.authentication &&
        (endpoint.path === "/api/auth" || endpoint.path.startsWith("/api/auth/")))
    )
      add(
        "PLATFORM_ROUTE_RESERVED",
        `${path}.path`,
        "This path belongs to a platform health/authentication handler. Choose a separate business path.",
      );
    const placeholders = [...endpoint.path.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
    if (
      new Set(placeholders).size !== placeholders.length ||
      placeholders.length !== endpoint.pathParams.length ||
      placeholders.some((name) => !endpoint.pathParams.some((p) => p.name === name))
    )
      add(
        "ENDPOINT_PATH_PARAMETERS_INVALID",
        `${path}.pathParams`,
        "Give every unique route placeholder exactly one matching required path parameter, and remove unused path parameters.",
      );
    const fields = fieldDefinitions(config, endpoint.entity);
    const inputs = new Set<string>();
    const reference = (
      ref: { entity: string; field: string },
      at: string,
    ): FieldDefinition | undefined => {
      const field = fieldDefinitions(config, ref.entity)[ref.field];
      if (!field)
        add(
          "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
          at,
          `Field "${ref.entity}.${ref.field}" does not exist. Correct the entity/field binding.`,
        );
      else if (!sameOwner(owners, endpoint.entity, ref.entity))
        add(
          "CROSS_MODULE_FIELD_REFERENCE",
          at,
          "This field binding crosses module ownership. Use a scalar input and a declared public application call.",
        );
      return field;
    };
    for (const [group, parameters] of [
      ["pathParams", endpoint.pathParams],
      ["queryParams", endpoint.queryParams],
    ] as const)
      for (const [pi, p] of parameters.entries()) {
        const at = `${path}.${group}[${pi}]`;
        if (inputs.has(p.name))
          add(
            "OPERATION_INPUT_COLLISION",
            `${at}.name`,
            `Input "${p.name}" is already bound. Use unique names across path, query and body.`,
          );
        inputs.add(p.name);
        if (Boolean(p.field) === Boolean(p.type))
          add(
            "PARAMETER_TYPE_INVALID",
            at,
            "Declare exactly one of field or type for this parameter.",
          );
        const field = p.field ? reference(p.field, `${at}.field`) : undefined;
        const type = field?.type ?? p.type;
        if (p.type === "enum" && (!p.enumName || !config.enums[p.enumName]))
          add(
            "UNKNOWN_PARAMETER_ENUM",
            `${at}.enumName`,
            "Select an existing enumName for this enum parameter.",
          );
        if (p.enumName && (p.field || p.type !== "enum"))
          add(
            "PARAMETER_TYPE_INVALID",
            `${at}.enumName`,
            "enumName is only allowed with an inline enum type. Field references inherit their enum.",
          );
        if (p.operator && (group !== "queryParams" || !p.field))
          add(
            "QUERY_OPERATOR_INVALID",
            `${at}.operator`,
            "Operators require a field-bound query parameter. Remove this operator or supply a query field binding.",
          );
        if (type === "json" && p.field)
          add(
            "QUERY_OPERATOR_INVALID",
            at,
            "JSON field filtering is unsupported. Use a typed application input without an automatic SQL binding.",
          );
        if (p.operator === "contains" && type !== "string")
          add(
            "QUERY_OPERATOR_INVALID",
            `${at}.operator`,
            "contains requires a string field. Choose a compatible field/operator.",
          );
        if (
          p.operator &&
          ["gt", "gte", "lt", "lte"].includes(p.operator) &&
          type !== "number" &&
          type !== "date"
        )
          add(
            "QUERY_OPERATOR_INVALID",
            `${at}.operator`,
            "Ordered comparisons require number or date fields.",
          );
        if (
          p.field &&
          p.field.entity !== endpoint.entity &&
          !endpoint.joins.some((j) => j.entity === p.field?.entity)
        )
          add(
            "QUERY_JOIN_REQUIRED",
            `${at}.field`,
            "Filtering a related entity requires an explicit matching direct join.",
          );
      }
    const joined = new Set<string>();
    for (const [ji, join] of endpoint.joins.entries()) {
      const at = `${path}.joins[${ji}]`;
      if (joined.has(join.entity))
        add("DUPLICATE_JOIN", at, "Join each related entity once. Remove this duplicate join.");
      joined.add(join.entity);
      if (!config.entities[join.entity])
        add(
          "UNKNOWN_JOIN_ENTITY",
          `${at}.entity`,
          `Entity "${join.entity}" does not exist. Choose a declared directly related entity.`,
        );
      else {
        if (!sameOwner(owners, endpoint.entity, join.entity))
          add(
            "CROSS_MODULE_JOIN",
            `${at}.entity`,
            "SQL joins must stay in one module. Use a scalar ID and a public application call across modules.",
          );
        if (
          entity &&
          Object.values(entity.relations).filter((r) => r.target === join.entity).length !== 1
        )
          add(
            "JOIN_RELATION_INVALID",
            `${at}.entity`,
            "Declare exactly one direct relation to this joined entity; multi-hop and ambiguous joins are unsupported.",
          );
        for (const [fi, name] of join.fields.entries())
          if (!fieldDefinitions(config, join.entity)[name])
            add(
              "UNKNOWN_JOIN_FIELD",
              `${at}.fields[${fi}]`,
              `Field "${name}" does not exist on "${join.entity}". Correct the projection.`,
            );
      }
    }
    const body = endpoint.requestBody;
    const useCase =
      body && "useCase" in body
        ? (body.useCase as { entity: string; operation: "create" | "update" })
        : undefined;
    if (body && ["GET", "DELETE"].includes(endpoint.method))
      add(
        "REQUEST_BODY_METHOD_INVALID",
        `${path}.requestBody`,
        "GET and DELETE cannot declare a request body. Remove the body or select an appropriate explicit method.",
      );
    if (useCase) {
      if (useCase.entity !== endpoint.entity)
        add(
          "REQUEST_BODY_ENTITY_MISMATCH",
          `${path}.requestBody.useCase.entity`,
          "The request-body useCase entity must equal the endpoint entity. Correct this reference.",
        );
      if (
        (useCase.operation === "create" && endpoint.method !== "POST") ||
        (useCase.operation === "update" && !["PUT", "PATCH"].includes(endpoint.method))
      )
        add(
          "REQUEST_BODY_OPERATION_METHOD_MISMATCH",
          `${path}.requestBody.useCase.operation`,
          "Use POST for create and PUT/PATCH for partial update.",
        );
      for (const name of Object.keys(entity?.fields ?? {})) {
        if (inputs.has(name))
          add(
            "OPERATION_INPUT_COLLISION",
            `${path}.requestBody`,
            `Body field "${name}" conflicts with a path/query input. Rename the parameter.`,
          );
        inputs.add(name);
      }
      for (const [name, field] of Object.entries(fields))
        if (!entity?.fields[name] && name !== "id" && field.type === "uuid") {
          if (inputs.has(name))
            add(
              "OPERATION_INPUT_COLLISION",
              `${path}.requestBody`,
              `Relation body field "${name}" conflicts with a parameter. Rename the parameter.`,
            );
          inputs.add(name);
        }
    } else if (body)
      for (const [name, definition] of Object.entries(body)) {
        const at = `${path}.requestBody.${name}`;
        if (inputs.has(name))
          add(
            "OPERATION_INPUT_COLLISION",
            at,
            `Input "${name}" is already bound. Choose a unique body property name.`,
          );
        inputs.add(name);
        if ("field" in definition) reference(definition.field, `${at}.field`);
        else validateField(definition, at, config, diagnostics);
      }
    const mutation = useCase !== undefined || endpoint.method === "DELETE";
    if (mutation && endpoint.joins.length)
      add(
        "OPERATION_MAPPING_UNSUPPORTED",
        `${path}.joins`,
        "Mutation joins are unsupported. Remove the join and use explicit application composition.",
      );
    if (useCase?.operation === "update" || endpoint.method === "DELETE") {
      const guard = [...endpoint.pathParams, ...endpoint.queryParams].some(
        (p) =>
          p.required &&
          p.field?.entity === endpoint.entity &&
          (p.operator === undefined || p.operator === "eq"),
      );
      if (!guard)
        add(
          "MUTATION_GUARD_REQUIRED",
          `${path}.pathParams`,
          "Update/delete requires a required main-entity equality path/query binding. Add a guard to prevent an unbounded write.",
        );
    }
    if (endpoint.pagination) {
      const profile = config.pagination[endpoint.pagination];
      if (!profile)
        add(
          "UNKNOWN_PAGINATION_PROFILE",
          `${path}.pagination`,
          `Profile "${endpoint.pagination}" does not exist. Declare it under pagination or select an existing profile.`,
        );
      if (endpoint.method !== "GET" || endpoint.pathParams.length)
        add(
          "PAGINATION_REQUIRES_GET",
          `${path}.pagination`,
          "Pagination requires a GET collection without path parameters. Correct the endpoint or remove pagination.",
        );
      if (profile && (inputs.has(profile.pageParam) || inputs.has(profile.pageSizeParam)))
        add(
          "PAGINATION_PARAMETER_CONFLICT",
          `${path}.pagination`,
          "Pagination names conflict with operation inputs. Rename the profile parameters or the other inputs.",
        );
    }
    if (backend) {
      const policy = effectiveAuthorization(backend);
      const known = new Set(
        Object.values(policy.rolePermissions)
          .flat()
          .filter((p) => p !== "*"),
      );
      if (
        !backend.authentication &&
        (endpoint.authRequired || endpoint.roles.length || endpoint.permissions.length)
      )
        add(
          "AUTHENTICATION_REQUIRED",
          `${path}.authRequired`,
          "This operation needs identity, but backend authentication is disabled. Enable Better Auth configuration or remove protected access requirements.",
        );
      if (endpoint.authRequired === false && (endpoint.roles.length || endpoint.permissions.length))
        add(
          "ACCESS_POLICY_CONFLICT",
          `${path}.authRequired`,
          "An explicitly public operation cannot require roles/permissions. Remove the public override or the access requirements.",
        );
      for (const [ri, role] of endpoint.roles.entries())
        if (!policy.roles.includes(role))
          add(
            "ROLE_UNKNOWN",
            `${path}.roles[${ri}]`,
            `Role "${role}" is not declared by this backend. Declare it or choose a known role.`,
          );
      for (const [pi, permission] of endpoint.permissions.entries())
        if (!known.has(permission) || permission.includes("*"))
          add(
            "PERMISSION_UNKNOWN",
            `${path}.permissions[${pi}]`,
            `Permission "${permission}" must be a concrete token declared in backend role grants. Correct it or declare its grant.`,
          );
    }
  }
  for (const [name, profile] of Object.entries(config.pagination))
    if (
      profile.pageParam === profile.pageSizeParam ||
      profile.defaultPageSize > profile.maxPageSize
    )
      add(
        "PAGINATION_PROFILE_INVALID",
        `pagination.${name}`,
        "Use distinct pagination parameter names and a defaultPageSize no greater than maxPageSize.",
      );
  return diagnostics;
}
