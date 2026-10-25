import type { NordixConfig } from "../configuration/schema.js";

export const IAM_PERMISSIONS = ["iam:roles:manage", "iam:users:manage-roles"] as const;
export const ORGANIZATION_PERMISSIONS = ["org:roles:manage", "org:members:manage"] as const;
export function organizationEntities(config: NordixConfig): ReadonlySet<string> {
  const entities = new Set(
    config.endpoints
      .filter((endpoint) => endpoint.scope === "organization")
      .flatMap((endpoint) => [endpoint.entity, ...endpoint.joins.map((join) => join.entity)]),
  );
  // Related records share tenant ownership; no global child can expose a tenant parent.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entity] of Object.entries(config.entities))
      for (const relation of Object.values(entity.relations)) {
        if (entities.has(name) || entities.has(relation.target)) {
          for (const value of [name, relation.target])
            if (!entities.has(value)) {
              entities.add(value);
              changed = true;
            }
        }
      }
  }
  return entities;
}

/** Capabilities are defined by application operations, never by runtime role names. */
export function backendPermissions(
  config: NordixConfig,
  backend: string,
  scope?: "global" | "organization",
): string[] {
  return [
    ...new Set([
      ...(scope === "organization"
        ? ORGANIZATION_PERMISSIONS
        : scope === "global"
          ? IAM_PERMISSIONS
          : [
              ...IAM_PERMISSIONS,
              ...(config.backends.find((app) => app.name === backend)?.authorization?.organizations
                .enabled
                ? ORGANIZATION_PERMISSIONS
                : []),
            ]),
      ...(scope === "organization"
        ? []
        : (config.backends.find((app) => app.name === backend)?.iac?.r2_storage ?? [])
      ).flatMap((key) => [`storage:${key}:read`, `storage:${key}:write`]),
      ...config.endpoints
        .filter(
          (endpoint) =>
            endpoint.backend === backend && (!scope || (endpoint.scope ?? "global") === scope),
        )
        .flatMap((endpoint) => endpoint.permissions)
        .filter((permission) => !permission.includes("*")),
    ]),
  ].sort();
}
