import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import {
  IAM_PERMISSIONS,
  ORGANIZATION_PERMISSIONS,
  backendPermissions,
  organizationEntities,
} from "../../project/permissions.js";
import type { BackendDefinition, NordixConfig } from "../schema.js";

export function validateAuthorization(
  config: NordixConfig,
  backend: BackendDefinition,
  index: number,
): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const root = `backends[${index}].authorization`;
  const add = (code: string, path: string, message: string) =>
    diagnostics.push(createDiagnostic(code, path, message));
  const authorization = backend.authorization;
  const tenantEntities = organizationEntities(config);
  for (const [name, entity] of Object.entries(config.entities)) {
    if (
      entity.backend === backend.name &&
      tenantEntities.has(name) &&
      Object.hasOwn(entity.fields, "organizationId")
    )
      add(
        "ORGANIZATION_FIELD_RESERVED",
        `entities.${name}.fields.organizationId`,
        "organizationId is generated from verified operation context and cannot be declared as client input.",
      );
  }
  if (authorization && !authorization.global.enabled && !authorization.organizations.enabled)
    add(
      "AUTHORIZATION_DOMAIN_REQUIRED",
      root,
      "Enable global or organizations authorization, or omit authorization entirely.",
    );
  for (const name of ["global", "organizations"] as const) {
    const policy = authorization?.[name];
    if (!authorization || !policy?.enabled) continue;
    const scope = name === "global" ? "global" : "organization";
    const administrator =
      name === "global" ? authorization.global.adminRole : authorization.organizations.ownerRole;
    const path = `${root}.${name}`;
    const management = scope === "global" ? IAM_PERMISSIONS : ORGANIZATION_PERMISSIONS;
    const known = new Set(backendPermissions(config, backend.name, scope));
    if (!policy.roles.length)
      add(
        "AUTHORIZATION_ROLES_REQUIRED",
        `${path}.roles`,
        "Declare at least one role for this enabled authorization domain.",
      );
    if (
      policy.defaultRole === administrator ||
      (policy.rolePermissions[policy.defaultRole] ?? []).some(
        (permission) => permission === "*" || management.some((value) => value === permission),
      )
    )
      add(
        "DEFAULT_ROLE_PRIVILEGED",
        `${path}.defaultRole`,
        "The default role must be different from the administrator/owner and cannot grant administrative permissions or a wildcard.",
      );
    if (!policy.roles.includes(policy.defaultRole))
      add("DEFAULT_ROLE_UNKNOWN", `${path}.defaultRole`, "The default role must occur in roles.");
    if (!policy.roles.includes(administrator))
      add(
        "ADMIN_ROLE_UNKNOWN",
        `${path}.${scope === "global" ? "adminRole" : "ownerRole"}`,
        "The administrator/owner role must occur in roles.",
      );
    if (Object.hasOwn(policy.rolePermissions, administrator))
      add(
        "ADMIN_ROLE_PERMISSIONS_RESERVED",
        `${path}.rolePermissions.${administrator}`,
        "The administrator/owner receives the contextual wildcard automatically; omit it from rolePermissions.",
      );
    for (const [role, grants] of Object.entries(policy.rolePermissions)) {
      if (!policy.roles.includes(role))
        add("ROLE_UNKNOWN", `${path}.rolePermissions.${role}`, "Grant owners must occur in roles.");
      for (const permission of grants) {
        if (permission.includes("*"))
          add(
            "PERMISSION_INVALID",
            `${path}.rolePermissions.${role}`,
            "Wildcards are reserved for the configured administrator/owner. Declare concrete permissions.",
          );
        else if (!known.has(permission))
          add(
            "PERMISSION_UNKNOWN",
            `${path}.rolePermissions.${role}`,
            `Permission "${permission}" is not a capability in the ${scope} authorization domain.`,
          );
      }
    }
  }
  for (const [ei, endpoint] of config.endpoints.entries()) {
    if (endpoint.backend !== backend.name) continue;
    const protectedEndpoint = endpoint.authRequired ?? Boolean(backend.authentication);
    const path = `endpoints[${ei}].scope`;
    if (tenantEntities.has(endpoint.entity) && endpoint.scope !== "organization")
      add(
        "ORGANIZATION_ENTITY_SCOPE_REQUIRED",
        path,
        "An organization-owned entity cannot also expose global/public operations. Use organization scope for every operation on this entity.",
      );
    if (authorization?.organizations.enabled && protectedEndpoint && !endpoint.scope)
      add(
        "AUTHORIZATION_SCOPE_REQUIRED",
        path,
        "Protected endpoints must explicitly declare scope: global or scope: organization when organizations are enabled.",
      );
    if (
      endpoint.scope === "organization" &&
      (!authorization?.organizations.enabled || !protectedEndpoint)
    )
      add(
        "ORGANIZATION_SCOPE_INVALID",
        path,
        "Organization operations require organization authorization and a verified session.",
      );
    if (
      (endpoint.scope ?? "global") === "global" &&
      endpoint.permissions.length &&
      !authorization?.global.enabled
    )
      add(
        "GLOBAL_AUTHORIZATION_REQUIRED",
        path,
        "Global permissions require authorization.global to be enabled.",
      );
  }
  return diagnostics;
}
