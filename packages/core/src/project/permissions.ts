import type { NordixConfig } from "../configuration/schema.js";

export const IAM_PERMISSIONS = ["iam:roles:manage", "iam:users:manage-roles"] as const;

/** Capabilities are defined by application operations, never by runtime role names. */
export function backendPermissions(config: NordixConfig, backend: string): string[] {
  return [
    ...new Set([
      ...IAM_PERMISSIONS,
      ...(config.backends.find((app) => app.name === backend)?.iac?.r2_storage ?? []).flatMap(
        (key) => [`storage:${key}:read`, `storage:${key}:write`],
      ),
      ...config.endpoints
        .filter((endpoint) => endpoint.backend === backend)
        .flatMap((endpoint) => endpoint.permissions)
        .filter((permission) => !permission.includes("*")),
    ]),
  ].sort();
}
