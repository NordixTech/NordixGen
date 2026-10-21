import {
  accountFormSource,
  accountPageSource,
  authInterfaceFiles,
} from "../../generation/auth-interface.js";
import { authJourneyFiles } from "../../generation/auth-journeys.js";
import { passwordPolicySource } from "../../generation/auth-policy.js";
import { identityBaseUrl } from "../../generation/frontend-access.js";
import type { GeneratedFile } from "../contracts.js";
import type {
  FrontendAuthenticationContract,
  FrontendRenderContext,
} from "../frontend-contracts.js";
import { accountMenuSource, profileFiles } from "./account-menu.js";
function source(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}
function authentication(context: FrontendRenderContext): FrontendAuthenticationContract {
  const contract = context.api.authentication;
  if (!contract) {
    throw new Error("Better Auth frontend integration requires a selected backend identity.");
  }
  return contract;
}
function authClientContent(context: FrontendRenderContext): string {
  const config = authentication(context);
  const apiBaseUrl = identityBaseUrl(context);
  const pluginImports: string[] = [];
  const pluginInits: string[] = [];
  if (config.methods.includes("phone-number")) {
    pluginImports.push('import {phoneNumberClient} from "better-auth/client/plugins";');
    pluginInits.push("phoneNumberClient()");
  }
  if (config.methods.includes("username-password")) {
    pluginImports.push('import { usernameClient } from "better-auth/client/plugins";');
    pluginInits.push("usernameClient()");
  }
  if (config.features.includes("two-factor")) {
    pluginImports.push('import { twoFactorClient } from "better-auth/client/plugins";');
    pluginInits.push("twoFactorClient()");
  }
  return source([
    '"use client";',
    "",
    'import { createAuthClient } from "better-auth/react";',
    ...pluginImports,
    "",
    `const API_BASE_URL = ${apiBaseUrl};`,
    "",
    "export const authClient = createAuthClient({",
    "  baseURL: API_BASE_URL,",
    '  fetchOptions: { credentials: "include" },',
    ...(pluginInits.length ? [`  plugins: [${pluginInits.join(", ")}],`] : []),
    "});",
    "",
    "export const { signIn, signOut, useSession, getSession } = authClient;",
    "",
    "export async function refreshSession() {",
    "  return getSession();",
    "}",
  ]);
}
function permissionsContent(config: FrontendAuthenticationContract): string {
  return source([
    "export interface SessionUser {",
    "  id: string;",
    "  email?: string | null;",
    "  name?: string | null;",
    "  username?: string | null;",
    "  role?: string | null;",
    "  permissions?: readonly string[];",
    "}",
    "",
    `export const knownPermissions = ${JSON.stringify(config.permissions)} as const;`,
    "",
    "// Presentation helper only. Hide or show UI with this function; never treat it as authorization.",
    "// Protected operations remain enforced by the generated backend.",
    "export function hasPermission(user: SessionUser | null | undefined, permission: string): boolean {",
    "  const grants = user?.permissions ?? [];",
    '  return knownPermissions.includes(permission as (typeof knownPermissions)[number]) && (grants.includes("*") || grants.includes(permission));',
    "}",
    "",
    "export function hasRole(user: SessionUser | null | undefined, role: string): boolean {",
    "  return user?.role === role;",
    "}",
    "",
    "export interface OperationAccess {authRequired:boolean;roles:readonly string[];permissions:readonly string[];}",
    "export function canAccessOperation(user:SessionUser|null,isPending:boolean,policy:OperationAccess):boolean {",
    " if((policy.authRequired || policy.roles.length>0 || policy.permissions.length>0) && (isPending || !user))return false;",
    " return policy.permissions.every(permission=>hasPermission(user,permission));",
    "}",
    "export function toSessionUser(user: SessionUser | null | undefined): SessionUser | null {",
    "  if (!user?.id) return null;",
    "  return { id: user.id, email: user.email ?? null, name: user.name ?? null, username: user.username ?? null, role: user.role ?? null, permissions: user.permissions ?? [] };",
    "}",
  ]);
}
function sessionViewContent(): string {
  return source([
    '"use client";',
    "",
    'import { authClient } from "@/lib/auth/client";',
    'import { useEffect, useState } from "react";',
    'import { iamRequest } from "@/lib/iam/client";',
    'import { canAccessOperation, hasPermission, hasRole, toSessionUser, type SessionUser, type OperationAccess } from "./permissions";',
    "",
    "type AccessState = { id: string; role: string; permissions: string[] } | null;",
    "let sharedAccess: AccessState = null;",
    "let inFlight: Promise<void> | null = null;",
    "let lastAccessAt = 0;",
    "const listeners = new Set<(access: AccessState) => void>();",
    "",
    "function setSharedAccess(next: AccessState) {",
    "  sharedAccess = next;",
    "  for (const listener of listeners) listener(next);",
    "}",
    "",
    "function refreshAccess(userId: string, userRole?: string | null, force = false) {",
    "  if (!force && sharedAccess?.id === userId && Date.now() - lastAccessAt < 30000) return Promise.resolve();",
    "  if (inFlight) return inFlight;",
    '  inFlight = iamRequest<{ id: string; role: string; permissions: string[] }>("/me")',
    "    .then((value) => { lastAccessAt = Date.now(); setSharedAccess(value); })",
    '    .catch(() => { setSharedAccess({ id: userId, role: userRole ?? "", permissions: [] }); })',
    "    .finally(() => { inFlight = null; });",
    "  return inFlight;",
    "}",
    "",
    "export function useSessionView(): {",
    "  user: SessionUser | null;",
    "  isPending: boolean;",
    "  hasPermission: (permission: string) => boolean;",
    "  hasRole: (role: string) => boolean;",
    "  canAccess: (policy: OperationAccess) => boolean;",
    "} {",
    "  const session = authClient.useSession();",
    "  const user = toSessionUser(session.data?.user);",
    "  const userId = user?.id, userRole = user?.role;",
    "  const [access, setAccess] = useState<AccessState>(() => (sharedAccess?.id === userId ? sharedAccess : null));",
    "  useEffect(() => {",
    "    listeners.add(setAccess);",
    "    if (!userId) {",
    "      if (sharedAccess !== null) setSharedAccess(null);",
    "      return () => { listeners.delete(setAccess); };",
    "    }",
    "    if (sharedAccess?.id !== userId) setAccess(null);",
    "    void refreshAccess(userId, userRole);",
    "    const onSync = () => void refreshAccess(userId, userRole);",
    "    const onChange = () => void refreshAccess(userId, userRole, true);",
    '    if (typeof window !== "undefined") {',
    '      window.addEventListener("focus", onSync);',
    '      window.addEventListener("iam-changed", onChange);',
    "    }",
    "    return () => {",
    "      listeners.delete(setAccess);",
    '      if (typeof window !== "undefined") {',
    '        window.removeEventListener("focus", onSync);',
    '        window.removeEventListener("iam-changed", onChange);',
    "      }",
    "    };",
    "  }, [userId, userRole]);",
    "  const currentAccess = access?.id === user?.id ? access : (sharedAccess?.id === user?.id ? sharedAccess : null);",
    "  const current = user ? { ...user, role: currentAccess ? currentAccess.role : user.role, permissions: currentAccess ? currentAccess.permissions : [] } : null;",
    "  const pending = session.isPending || Boolean(user && currentAccess?.id !== user.id);",
    "  return {",
    "    user: current,",
    "    isPending: pending,",
    "    hasPermission: (permission) => hasPermission(current, permission),",
    "    hasRole: (role) => hasRole(current, role),",
    "    canAccess: (policy) => canAccessOperation(current, pending, policy),",
    "  };",
    "}",
  ]);
}
function signOutButtonContent(): string {
  return source([
    '"use client";',
    "",
    'import { useState } from "react";',
    'import { Button } from "@/components/ui/button";',
    'import { authClient } from "@/lib/auth/client";',
    'import {useUIStore} from "@/stores/ui-store";',
    "",
    "export function SignOutButton() {",
    "  const notify=useUIStore(state=>state.notify);",
    "  const [pending, setPending] = useState(false);",
    "  return (",
    "    <Button",
    "      disabled={pending}",
    "      onClick={async () => {",
    "        setPending(true);",
    "        try {const result=await authClient.signOut();if(result.error){notify(result.error.message ?? 'Sign-out failed.','alert');return;}",
    '        window.location.replace("/sign-in");',
    "        }catch{notify('Could not reach the authentication server. Please try signing out again.','alert');}finally{setPending(false);}",
    "      }}",
    '      type="button"',
    '      variant="secondary"',
    "    >",
    "      Sign out",
    "    </Button>",
    "  );",
    "}",
  ]);
}
function authReadme(config: FrontendAuthenticationContract): string {
  return source([
    "# Frontend authentication",
    "",
    `This frontend uses the Better Auth session from backend \`${config.backend}\`.`,
    "",
    "- Sign-in, sign-out, and session refresh call the backend authentication HTTP API.",
    "- New accounts receive the backend's default role; role assignment is server-controlled.",
    "- The browser stores the session in HttpOnly cookies. Do not copy tokens into Zustand, React state, or localStorage.",
    "- Add this frontend origin to the backend `AUTH_TRUSTED_ORIGINS` list so credentialed requests and CSRF origin checks succeed.",
    "- Browser auth and IAM use this frontend origin through /api/auth/* and /api/auth/iam/*. Never configure a public backend URL.",
    "- Page guards forward the requesting cookie only to that configured authority, without redirects or caching. Identity failures render an unavailable error; invalid sessions redirect to the local sign-in page.",
    "- Local Next server calls use BACKEND_<NAME>_INTERNAL_URL. In Cloudflare, server calls use Service Bindings and fail closed if missing. BETTER_AUTH_URL is the public frontend origin and AUTH_TRUSTED_ORIGINS lists its allowed origins.",
    "- `hasPermission` / `hasRole` are presentation helpers. Backend policies remain authoritative.",
  ]);
}
export function generateFrontendAuthFiles(
  context: FrontendRenderContext,
): readonly GeneratedFile[] {
  const config = authentication(context);
  const root = context.framework.codeRoot;
  const files = [
    ...authJourneyFiles(root, config),
    ...profileFiles(root, config),
    ...authInterfaceFiles(root),
    {
      path: `${root}/lib/auth/password-policy.ts`,
      content: passwordPolicySource(config.passwordPolicy),
    },
    { path: `${root}/lib/auth/client.ts`, content: authClientContent(context) },
    { path: `${root}/lib/auth/permissions.ts`, content: permissionsContent(config) },
    { path: `${root}/lib/auth/use-session-view.ts`, content: sessionViewContent() },
    { path: `${root}/lib/auth/README.md`, content: authReadme(config) },
    { path: `${root}/components/auth/sign-out-button.tsx`, content: signOutButtonContent() },
  ];
  if (context.api.authentication) {
    files.push(
      { path: `${root}/components/auth/auth-controls.tsx`, content: accountMenuSource },
      {
        path: `${root}/components/auth/sign-in-form.tsx`,
        content: accountFormSource(config, false),
      },
      {
        path: `${root}/components/auth/sign-up-form.tsx`,
        content: accountFormSource(config, true),
      },
      { path: `${root}/app/sign-in/page.tsx`, content: accountPageSource(false) },
      { path: `${root}/app/sign-up/page.tsx`, content: accountPageSource(true) },
    );
  }
  return files;
}
