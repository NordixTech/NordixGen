import { posix } from "node:path";
import type { GeneratedFile, GeneratorPlugin, PluginContributionContext } from "../contracts.js";

interface AuthorizationSelection {
  authorization?: {
    roles?: readonly string[];
    rolePermissions?: Readonly<Record<string, readonly string[]>>;
  };
}

export const rbacPbacPlugin: GeneratorPlugin = {
  descriptor: {
    id: "rbac-pbac",
    version: "1.0.0",
    role: "authorization",
    provides: ["authorization:role-policy", "authorization:permission-policy"],
    requires: [
      {
        capability: "authentication:verified-principal",
        description:
          "Server-side authorization requires an authenticated principal from an authentication plugin.",
      },
    ],
  },
  contribute(context): readonly GeneratedFile[] {
    const selection = context.selection.configuration as AuthorizationSelection | undefined;
    const authorization = selection?.authorization;
    if (!authorization) {
      throw new Error("RBAC/PBAC requires validated authorization roles and permission grants.");
    }
    const grants = Object.fromEntries(
      Object.entries(authorization.rolePermissions ?? {}).sort(([left], [right]) =>
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
          "  const grants = rolePermissions[role] ?? [];",
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
          "Role assignments are server-owned. The Better Auth `user.role` field rejects sign-up input; assign roles through a trusted administrative workflow or controlled database migration.",
          "",
        ].join("\n"),
      },
    ];
  },
};
