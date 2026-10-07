import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";
import { normalizeBackends } from "../schema.js";

const GENERATED_ENTITY_FIELDS = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);

export function validateEndpoints(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const backends = normalizeBackends(config);
  const knownRoles = new Set(
    backends.flatMap((backend) => (backend.auth.type === "none" ? [] : backend.auth.roles)),
  );
  const knownPermissions = new Set(
    backends.flatMap((backend) => (backend.auth.type === "none" ? [] : backend.auth.permissions)),
  );
  const endpointKeys = new Set<string>();

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

    if (!config.entities[endpoint.entity]) {
      diagnostics.push(
        createDiagnostic(
          "UNKNOWN_ENDPOINT_ENTITY",
          `${endpointPath}.entity`,
          `Entity "${endpoint.entity}" is not defined.`,
        ),
      );
    }
    for (const role of endpoint.roles) {
      if (!knownRoles.has(role)) {
        diagnostics.push(
          createDiagnostic(
            "UNKNOWN_ENDPOINT_ROLE",
            `${endpointPath}.roles`,
            `Role "${role}" is not declared by an authenticated backend.`,
          ),
        );
      }
    }
    for (const permission of endpoint.permissions) {
      if (!knownPermissions.has(permission)) {
        diagnostics.push(
          createDiagnostic(
            "UNKNOWN_ENDPOINT_PERMISSION",
            `${endpointPath}.permissions`,
            `Permission "${permission}" is not declared by an authenticated backend.`,
          ),
        );
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
      for (const field of join.fields) {
        if (!joinedEntity.fields[field] && !GENERATED_ENTITY_FIELDS.has(field)) {
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
      }
    }
  }

  return diagnostics;
}
