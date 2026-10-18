import { posix } from "node:path";
import type { BackendRenderContext, GeneratedFile } from "../contracts.js";
export function generateAuthorizationFiles(
  context: BackendRenderContext,
): readonly GeneratedFile[] {
  const authorization = context.identity;
  if (!authorization) throw new Error("A resolved identity is required for authorization.");
  const grants = Object.fromEntries(
    Object.entries(authorization.rolePermissions).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const infrastructure = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.infrastructure,
  );
  const policyPath = posix.join(infrastructure, "authorization/policy.ts");
  return [
    {
      path: policyPath,
      content: [
        "export interface AuthorizationPrincipal { role?: string | null; }",
        "export interface AuthorizationRequirements { roles: readonly string[]; permissions: readonly string[]; }",
        `export const rolePermissions: Readonly<Record<string, readonly string[]>> = Object.freeze(${JSON.stringify(grants, null, 2)});`,
        "",
        "export function isAuthorized(",
        "  principal: AuthorizationPrincipal,",
        "  requirements: AuthorizationRequirements,",
        "): boolean {",
        '  const role = principal.role ?? "";',
        "  if (requirements.roles.length > 0 && !requirements.roles.includes(role)) return false;",
        "  const grants = Object.hasOwn(rolePermissions, role) ? rolePermissions[role] : [];",
        '  return requirements.permissions.every((permission) => grants.includes(permission) || grants.includes("*"));',
        "}",
        "",
      ].join("\n"),
    },
    {
      path: posix.join(infrastructure, "authorization/README.md"),
      content: [
        "# Backend authorization policies",
        "",
        "Authorization is enforced by backend code using the verified Better Auth session. Frontend state never grants access.",
        "A route's declared roles and permissions are both required when both are present. Every permission must be granted to the user's server-owned role.",
        "",
        "Role assignments are server-owned. Better Auth does not accept `user.role` as sign-up input; assign roles through a trusted administrative workflow or controlled database migration.",
        "",
      ].join("\n"),
    },
  ];
}
