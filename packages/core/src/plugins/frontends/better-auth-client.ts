import { authJourneyFiles } from "../../generation/auth-journeys.js";
import { passwordPolicySource } from "../../generation/auth-policy.js";
import { identityBaseUrl } from "../../generation/frontend-access.js";
import { DEFAULT_PASSWORD_POLICY } from "../../project/account-policy.js";
import type { GeneratedFile } from "../contracts.js";
import type {
  FrontendAuthenticationContract,
  FrontendRenderContext,
} from "../frontend-contracts.js";
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
    "const listeners = new Set<(access: AccessState) => void>();",
    "",
    "function setSharedAccess(next: AccessState) {",
    "  sharedAccess = next;",
    "  for (const listener of listeners) listener(next);",
    "}",
    "",
    "function refreshAccess(userId: string, userRole?: string | null) {",
    "  if (inFlight) return inFlight;",
    '  inFlight = iamRequest<{ id: string; role: string; permissions: string[] }>("/me")',
    "    .then((value) => { setSharedAccess(value); })",
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
    "    const timer = setInterval(() => void refreshAccess(userId, userRole), 5000);",
    "    const onSync = () => void refreshAccess(userId, userRole);",
    '    if (typeof window !== "undefined") {',
    '      window.addEventListener("focus", onSync);',
    '      window.addEventListener("iam-changed", onSync);',
    "    }",
    "    return () => {",
    "      listeners.delete(setAccess);",
    "      clearInterval(timer);",
    '      if (typeof window !== "undefined") {',
    '        window.removeEventListener("focus", onSync);',
    '        window.removeEventListener("iam-changed", onSync);',
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
    'import { useRouter } from "next/navigation";',
    'import { useState } from "react";',
    'import { Button } from "@/components/ui/button";',
    'import { authClient } from "@/lib/auth/client";',
    'import {useUIStore} from "@/stores/ui-store";',
    "",
    "export function SignOutButton() {",
    "  const router = useRouter();",
    "  const notify=useUIStore(state=>state.notify);",
    "  const [pending, setPending] = useState(false);",
    "  return (",
    "    <Button",
    "      disabled={pending}",
    "      onClick={async () => {",
    "        setPending(true);",
    "        try {const result=await authClient.signOut();if(result.error){notify(result.error.message ?? 'Sign-out failed.','alert');return;}",
    '        router.replace("/sign-in");',
    "        router.refresh();",
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
function authControlsContent(config: FrontendAuthenticationContract): string {
  return source([
    '"use client";',
    "",
    'import { useSessionView } from "@/lib/auth/use-session-view";',
    'import { SignOutButton } from "@/components/auth/sign-out-button";',
    "",
    "export function AuthControls() {",
    "  const { user, isPending, hasPermission } = useSessionView();",
    '  if (isPending) return <span aria-label="Checking login status" className="ng-account-state" role="status"><span aria-hidden="true" className="ng-account-icon">◌</span><span>Checking session…</span></span>;',
    '  if (!user) return <a aria-label="Signed out. Sign in" className="ng-account-state" href="/sign-in"><span aria-hidden="true" className="ng-account-icon">♙</span><span>Signed out · Sign in</span></a>;',
    "  return (",
    '    <div aria-label={`Signed in as ${user.name ?? user.email}${user.role ? `, role ${user.role}` : ""}`} className="ng-account-state" role="status">',
    '      <span aria-hidden="true" className="ng-account-icon ng-account-icon--signed-in">♙</span>',
    '      <span>{user.name ?? user.email} · {user.role ?? "no role"}</span>',
    "      <SignOutButton />",
    ...(config.methods.includes("phone-number") ? ['      <a href="/profile">Profile</a>'] : []),
    '      {(hasPermission("iam:roles:manage")||hasPermission("iam:users:manage-roles"))&&<a href="/admin/roles">Administration</a>}',
    "    </div>",
    "  );",
    "}",
  ]);
}
function signInFormContent(config: FrontendAuthenticationContract): string {
  if (!config.methods.includes("email-password"))
    return '"use client";\nimport {PhoneForm} from "@/components/auth/phone-form";\nexport function SignInForm(){return <PhoneForm/>;}\n';
  const username = config.methods.includes("username-password");
  const providers = config.identityProviders;
  return source([
    '"use client";',
    "",
    'import { useState, type FormEvent } from "react";',
    'import { useRouter } from "next/navigation";',
    'import { Button } from "@/components/ui/button";',
    'import { Input } from "@/components/ui/input";',
    'import { Notice } from "@/components/ui/notice";',
    'import { authClient } from "@/lib/auth/client";',
    ...(config.methods.includes("phone-number")
      ? ['import {PhoneForm} from "@/components/auth/phone-form";']
      : []),
    "",
    "export function SignInForm() {",
    "  const router = useRouter();",
    "  const [error, setError] = useState<string>();",
    "  const [pending, setPending] = useState(false);",
    ...(username ? ['  const [mode, setMode] = useState<"email" | "username">("email");'] : []),
    "  async function submit(event: FormEvent<HTMLFormElement>) {",
    "    event.preventDefault();",
    "    const form = new FormData(event.currentTarget);",
    "    setPending(true);",
    "    setError(undefined);",
    "    try {",
    ...(username
      ? [
          '      const result = mode === "username"',
          '        ? await authClient.signIn.username({ username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") })',
          '        : await authClient.signIn.email({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });',
        ]
      : [
          '      const result = await authClient.signIn.email({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });',
        ]),
    "      if (result.error) {",
    '        setError(result.error.message ?? "Sign-in failed.");',
    "        return;",
    "      }",
    "      await authClient.getSession();",
    '      router.replace("/");',
    "      router.refresh();",
    "    } catch {",
    '      setError("Could not reach the authentication service. Please try again.");',
    "    } finally {",
    "      setPending(false);",
    "    }",
    "  }",
    "  return (",
    '    <> <form className="ng-panel" onSubmit={submit}>',
    '      {error ? <Notice tone="alert">{error}</Notice> : null}',
    ...(username
      ? [
          '      <div className="ng-actions">',
          '        <Button onClick={() => setMode("email")} type="button" variant={mode === "email" ? "primary" : "secondary"}>Email</Button>',
          '        <Button onClick={() => setMode("username")} type="button" variant={mode === "username" ? "primary" : "secondary"}>Username</Button>',
          "      </div>",
          '      {mode === "email" ? <Input autoComplete="email" id="email" label="Email" name="email" required type="email" /> : <Input autoComplete="username" id="username" label="Username" name="username" required />}',
        ]
      : [
          '      <Input autoComplete="email" id="email" label="Email" name="email" required type="email" />',
        ]),
    '      <Input autoComplete="current-password" id="password" label="Password" name="password" required type="password" />',
    '      <Button disabled={pending} type="submit">Sign in</Button>',
    '      <a href="/forgot-password">Forgot your password?</a>',
    '      <p className="ng-panel-note">New here? <a className="ng-text-link" href="/sign-up">Create an account</a></p>',
    ...providers.flatMap((provider) => [
      "      <Button",
      "        disabled={pending}",
      "        onClick={async () => {",
      "          setPending(true);",
      `          await authClient.signIn.social({ provider: ${JSON.stringify(provider)}, callbackURL: "/" });`,
      "        }}",
      '        type="button"',
      '        variant="secondary"',
      "      >",
      `        Continue with ${provider}`,
      "      </Button>",
    ]),
    "    </form>",
    ...(config.methods.includes("phone-number") ? ["    <PhoneForm/>"] : []),
    "    </>",
    "  );",
    "}",
  ]);
}
function signUpFormContent(config: FrontendAuthenticationContract): string {
  if (!config.methods.includes("email-password"))
    return '"use client";\nimport {PhoneForm} from "@/components/auth/phone-form";\nexport function SignUpForm(){return <PhoneForm/>;}\n';
  const policy = config.passwordPolicy ?? DEFAULT_PASSWORD_POLICY;
  return source([
    '"use client";',
    "",
    'import { useState, type FormEvent } from "react";',
    'import { useRouter } from "next/navigation";',
    'import { Button } from "@/components/ui/button";',
    'import { Input } from "@/components/ui/input";',
    'import { Notice } from "@/components/ui/notice";',
    'import { authClient } from "@/lib/auth/client";',
    ...(config.methods.includes("phone-number")
      ? ['import {PhoneForm} from "@/components/auth/phone-form";']
      : []),
    'import {passwordSchema} from "@/lib/auth/password-policy";',
    "",
    "export function SignUpForm() {",
    "  const router = useRouter();",
    "  const [error, setError] = useState<string>();",
    "  const [pending, setPending] = useState(false);",
    "  async function submit(event: FormEvent<HTMLFormElement>) {",
    "    event.preventDefault();",
    "    const form = new FormData(event.currentTarget);",
    "    setPending(true);",
    "    setError(undefined);",
    "    try {",
    '      const password=String(form.get("password")??"");const parsed=passwordSchema.safeParse(password);if(!parsed.success){setError(parsed.error.issues[0].message);return;}',
    '      const result = await authClient.signUp.email({ name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), password });',
    "      if (result.error) {",
    '        setError(result.error.message ?? "Sign-up failed.");',
    "        return;",
    "      }",
    "      await authClient.getSession();",
    '      router.replace("/");',
    "      router.refresh();",
    "    } catch {",
    '      setError("Could not reach the authentication service. Please try again.");',
    "    } finally {",
    "      setPending(false);",
    "    }",
    "  }",
    "  return (",
    '    <> <form className="ng-panel" onSubmit={submit}>',
    '      {error ? <Notice tone="alert">{error}</Notice> : null}',
    '      <Input autoComplete="name" id="name" label="Name" name="name" required />',
    '      <Input autoComplete="email" id="email" label="Email" name="email" required type="email" />',
    `      <Input autoComplete="new-password" id="password" label="${policy.numericOnly ? "PIN" : "Password"} (at least ${policy.minLength} characters)" name="password" minLength={${policy.minLength}} maxLength={${policy.maxLength}} ${policy.numericOnly ? 'inputMode="numeric" pattern="[0-9]+" ' : ""}required type="password" />`,
    '      <Button disabled={pending} type="submit">Create account</Button>',
    '      <p className="ng-panel-note">Already registered? <a className="ng-text-link" href="/sign-in">Sign in</a></p>',
    "    </form>",
    ...(config.methods.includes("phone-number") ? ["    <PhoneForm/>"] : []),
    "    </>",
    "  );",
    "}",
  ]);
}
function signInPageContent(): string {
  return source([
    'import { SignInForm } from "@/components/auth/sign-in-form";',
    "",
    'export const metadata = { title: "Sign in" };',
    "",
    "export default function SignInPage() {",
    "  return (",
    '    <main className="ng-shell">',
    '      <section className="ng-hero">',
    "        <div>",
    '          <p className="ng-eyebrow">Secure session</p>',
    "          <h1>Sign in</h1>",
    '          <p className="ng-lede">Browser sessions use HttpOnly cookies from the configured identity backend. This UI never stores session secrets.</p>',
    "        </div>",
    "        <SignInForm />",
    "      </section>",
    "    </main>",
    "  );",
    "}",
  ]);
}
function signUpPageContent(): string {
  return source([
    'import { SignUpForm } from "@/components/auth/sign-up-form";',
    "",
    'export const metadata = { title: "Create account" };',
    "",
    "export default function SignUpPage() {",
    "  return (",
    '    <main className="ng-shell">',
    '      <section className="ng-hero">',
    "        <div>",
    '          <p className="ng-eyebrow">New account</p>',
    "          <h1>Create your account</h1>",
    '          <p className="ng-lede">Your account receives the backend’s default role. Roles cannot be selected during sign-up.</p>',
    "        </div>",
    "        <SignUpForm />",
    "      </section>",
    "    </main>",
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
      { path: `${root}/components/auth/auth-controls.tsx`, content: authControlsContent(config) },
      { path: `${root}/components/auth/sign-in-form.tsx`, content: signInFormContent(config) },
      { path: `${root}/components/auth/sign-up-form.tsx`, content: signUpFormContent(config) },
      { path: `${root}/app/sign-in/page.tsx`, content: signInPageContent() },
      { path: `${root}/app/sign-up/page.tsx`, content: signUpPageContent() },
    );
  }
  return files;
}
