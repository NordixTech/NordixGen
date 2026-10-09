import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { EndpointDefinition, FieldDefinition, NordixConfig } from "../schema.js";
import { normalizeBackends } from "../schema.js";

function resolvedEntityField(
  config: NordixConfig,
  entityName: string,
  fieldName: string,
): FieldDefinition | undefined {
  const entity = config.entities[entityName];
  if (!entity) return undefined;
  const declared = entity.fields[fieldName];
  if (declared) return declared;
  if (fieldName === "id") return { type: "uuid", required: true, unique: true, default: undefined };
  if (fieldName === "createdAt" && entity.timestamps.createdAt) {
    return { type: "date", required: true, unique: false, default: undefined };
  }
  if (fieldName === "updatedAt" && entity.timestamps.updatedAt) {
    return { type: "date", required: true, unique: false, default: undefined };
  }
  if (fieldName === "isDeleted" && entity.softDelete === "boolean") {
    return { type: "boolean", required: true, unique: false, default: false };
  }
  if (fieldName === "deletedAt" && entity.softDelete === "timestamp") {
    return { type: "date", required: false, unique: false, default: undefined };
  }
  return undefined;
}

function isRequestBodyUseCase(
  body: NonNullable<EndpointDefinition["requestBody"]>,
): body is { useCase: { entity: string; operation: "create" | "update" } } {
  if (!("useCase" in body)) return false;
  const reference: unknown = body.useCase;
  return (
    typeof reference === "object" &&
    reference !== null &&
    "entity" in reference &&
    "operation" in reference &&
    typeof reference.entity === "string" &&
    (reference.operation === "create" || reference.operation === "update")
  );
}

export function validateEndpoints(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const backends = normalizeBackends(config);
  const backendsByName = new Map(backends.map((backend) => [backend.name, backend]));
  const endpointKeys = new Set<string>();
  const operationIds = new Set<string>();

  for (const [index, endpoint] of config.endpoints.entries()) {
    const endpointPath = `endpoints.${index}`;
    const endpointKey = `${endpoint.method} ${endpoint.path}`;
    if (endpointKeys.has(endpointKey)) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_ENDPOINT",
          `${endpointPath}.path`,
          `Endpoint ${endpointKey} is declared more than once.`,
        ),
      );
    }
    endpointKeys.add(endpointKey);
    if (endpoint.operationId) {
      const operationKey = `${endpoint.backend}:${endpoint.operationId}`;
      if (operationIds.has(operationKey)) {
        diagnostics.push(
          createDiagnostic(
            "DUPLICATE_OPERATION_ID",
            `${endpointPath}.operationId`,
            `Operation ID "${endpoint.operationId}" is already used by backend "${endpoint.backend}".`,
          ),
        );
      }
      operationIds.add(operationKey);
    }

    const backend = backendsByName.get(endpoint.backend);
    if (!backend) {
      diagnostics.push(
        createDiagnostic(
          "UNKNOWN_ENDPOINT_BACKEND",
          `${endpointPath}.backend`,
          `Backend "${endpoint.backend}" is not configured.`,
        ),
      );
    }

    const endpointEntity = config.entities[endpoint.entity];
    if (!endpointEntity) {
      diagnostics.push(
        createDiagnostic(
          "UNKNOWN_ENDPOINT_ENTITY",
          `${endpointPath}.entity`,
          `Entity "${endpoint.entity}" is not defined.`,
        ),
      );
    } else if (endpointEntity.backend !== endpoint.backend) {
      diagnostics.push(
        createDiagnostic(
          "ENDPOINT_ENTITY_BACKEND_MISMATCH",
          `${endpointPath}.entity`,
          `Entity "${endpoint.entity}" belongs to backend "${endpointEntity.backend}", not "${endpoint.backend}".`,
        ),
      );
    }
    if (backend) {
      const knownRoles = backend.auth.type === "none" ? [] : backend.auth.roles;
      const knownPermissions = backend.auth.type === "none" ? [] : backend.auth.permissions;
      for (const role of endpoint.roles) {
        if (!knownRoles.includes(role)) {
          diagnostics.push(
            createDiagnostic(
              "UNKNOWN_ENDPOINT_ROLE",
              `${endpointPath}.roles`,
              `Role "${role}" is not declared by backend "${backend.name}".`,
            ),
          );
        }
      }
      for (const permission of endpoint.permissions) {
        if (!knownPermissions.includes(permission)) {
          diagnostics.push(
            createDiagnostic(
              "UNKNOWN_ENDPOINT_PERMISSION",
              `${endpointPath}.permissions`,
              `Permission "${permission}" is not declared by backend "${backend.name}".`,
            ),
          );
        }
      }
    }
    for (const [joinIndex, join] of endpoint.joins.entries()) {
      const joinPath = `${endpointPath}.joins.${joinIndex}`;
      const joinedEntity = config.entities[join.entity];
      if (!joinedEntity) {
        diagnostics.push(
          createDiagnostic(
            "UNKNOWN_JOIN_ENTITY",
            `${joinPath}.entity`,
            `Entity "${join.entity}" is not defined.`,
          ),
        );
        continue;
      }
      if (joinedEntity.backend !== endpoint.backend) {
        diagnostics.push(
          createDiagnostic(
            "CROSS_BACKEND_JOIN",
            `${joinPath}.entity`,
            `Endpoint joins must stay within backend "${endpoint.backend}"; entity "${join.entity}" belongs to "${joinedEntity.backend}".`,
          ),
        );
      }
      for (const field of join.fields) {
        if (!resolvedEntityField(config, join.entity, field)) {
          diagnostics.push(
            createDiagnostic(
              "UNKNOWN_JOIN_FIELD",
              `${joinPath}.fields`,
              `Field "${field}" is not defined on entity "${join.entity}".`,
            ),
          );
        }
      }
    }
    for (const [parameterGroup, parameters] of [
      ["queryParams", endpoint.queryParams],
      ["pathParams", endpoint.pathParams],
    ] as const) {
      for (const [parameterIndex, parameter] of parameters.entries()) {
        const parameterPath = `${endpointPath}.${parameterGroup}.${parameterIndex}`;
        if (
          parameter.type === "enum" &&
          (!parameter.enumName || !config.enums[parameter.enumName])
        ) {
          diagnostics.push(
            createDiagnostic(
              "UNKNOWN_PARAMETER_ENUM",
              `${endpointPath}.${parameterGroup}.${parameterIndex}.enumName`,
              `Enum "${parameter.enumName ?? ""}" is not defined under enums.`,
            ),
          );
        }
        if (parameter.field) {
          const sourceEntity = config.entities[parameter.field.entity];
          const sourceField = resolvedEntityField(
            config,
            parameter.field.entity,
            parameter.field.field,
          );
          if (!sourceEntity || !sourceField) {
            diagnostics.push(
              createDiagnostic(
                "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
                `${parameterPath}.field`,
                `Field reference "${parameter.field.entity}.${parameter.field.field}" does not exist.`,
              ),
            );
          } else {
            if (sourceEntity.backend !== endpoint.backend) {
              diagnostics.push(
                createDiagnostic(
                  "CROSS_BACKEND_FIELD_REFERENCE",
                  `${parameterPath}.field`,
                  `Field references must stay within backend "${endpoint.backend}".`,
                ),
              );
            }
            if (parameter.type && parameter.type !== sourceField.type) {
              diagnostics.push(
                createDiagnostic(
                  "ENDPOINT_FIELD_TYPE_MISMATCH",
                  `${parameterPath}.type`,
                  `Parameter type "${parameter.type}" does not match "${parameter.field.entity}.${parameter.field.field}" (${sourceField.type}).`,
                ),
              );
            }
            if (
              parameter.enumName &&
              (sourceField.type !== "enum" || parameter.enumName !== sourceField.enumName)
            ) {
              diagnostics.push(
                createDiagnostic(
                  "ENDPOINT_FIELD_ENUM_MISMATCH",
                  `${parameterPath}.enumName`,
                  `Enum reference does not match "${parameter.field.entity}.${parameter.field.field}".`,
                ),
              );
            }
          }
        }
      }
    }
    if (endpoint.pagination) {
      if (endpoint.method !== "GET") {
        diagnostics.push(
          createDiagnostic(
            "PAGINATION_REQUIRES_GET",
            `${endpointPath}.pagination`,
            "Pagination is only supported on GET collection endpoints.",
          ),
        );
      }
      const queryNames = new Set(endpoint.queryParams.map((parameter) => parameter.name));
      if (
        queryNames.has(endpoint.pagination.pageParam) ||
        queryNames.has(endpoint.pagination.pageSizeParam)
      ) {
        diagnostics.push(
          createDiagnostic(
            "PAGINATION_PARAMETER_CONFLICT",
            `${endpointPath}.pagination`,
            "Pagination query parameter names must not collide with declared query parameters.",
          ),
        );
      }
    }
    if (endpoint.requestBody) {
      if (isRequestBodyUseCase(endpoint.requestBody)) {
        const reference = endpoint.requestBody.useCase;
        const entity = config.entities[reference.entity];
        if (
          !entity ||
          entity.backend !== endpoint.backend ||
          reference.entity !== endpoint.entity
        ) {
          diagnostics.push(
            createDiagnostic(
              "UNKNOWN_REQUEST_BODY_ENTITY",
              `${endpointPath}.requestBody.useCase.entity`,
              `Request body use case entity "${reference.entity}" must match this endpoint's entity and backend.`,
            ),
          );
        }
        if (
          (reference.operation === "create" && endpoint.method !== "POST") ||
          (reference.operation === "update" && !["PUT", "PATCH"].includes(endpoint.method))
        ) {
          diagnostics.push(
            createDiagnostic(
              "REQUEST_BODY_OPERATION_METHOD_MISMATCH",
              `${endpointPath}.requestBody.useCase.operation`,
              `The ${reference.operation} request-body contract is incompatible with method ${endpoint.method}.`,
            ),
          );
        }
      } else {
        for (const [propertyName, property] of Object.entries(endpoint.requestBody)) {
          if (!("field" in property)) continue;
          const sourceEntity = config.entities[property.field.entity];
          const sourceField = resolvedEntityField(
            config,
            property.field.entity,
            property.field.field,
          );
          if (!sourceEntity || !sourceField) {
            diagnostics.push(
              createDiagnostic(
                "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
                `${endpointPath}.requestBody.${propertyName}.field`,
                `Field reference "${property.field.entity}.${property.field.field}" does not exist.`,
              ),
            );
          } else if (sourceEntity.backend !== endpoint.backend) {
            diagnostics.push(
              createDiagnostic(
                "CROSS_BACKEND_FIELD_REFERENCE",
                `${endpointPath}.requestBody.${propertyName}.field`,
                `Field references must stay within backend "${endpoint.backend}".`,
              ),
            );
          }
        }
      }
    }
  }

  return diagnostics;
}
