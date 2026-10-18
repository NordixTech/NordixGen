import { ACCOUNT_POLICY } from "../../project/account-policy.js";
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
  const apiBaseUrl = 'process.env.NEXT_PUBLIC_API_BASE_URL ?? ""';
  const pluginImports: string[] = [];
  const pluginInits: string[] = [];
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
  const grants = Object.fromEntries(
    Object.entries(config.rolePermissions).sort(([left], [right]) => left.localeCompare(right)),
  );
  return source([
    "export interface SessionUser {",
    "  id: string;",
    "  email?: string | null;",
    "  name?: string | null;",
    "  username?: string | null;",
    "  role?: string | null;",
    "}",
    "",
    `export const rolePermissions: Readonly<Record<string, readonly string[]>> = Object.freeze(${JSON.stringify(grants, null, 2)});`,
    "",
    "// Presentation helper only. Hide or show UI with this function; never treat it as authorization.",
    "// Protected operations remain enforced by the generated backend.",
    "export function hasPermission(user: SessionUser | null | undefined, permission: string): boolean {",
    '  const role = user?.role ?? "";',
    "  const grants = Object.hasOwn(rolePermissions, role) ? rolePermissions[role] : [];",
    '  return grants.includes("*") || grants.includes(permission);',
    "}",
    "",
    "export function hasRole(user: SessionUser | null | undefined, role: string): boolean {",
    "  return user?.role === role;",
    "}",
    "",
    "export function toSessionUser(user: SessionUser | null | undefined): SessionUser | null {",
    "  if (!user?.id) return null;",
    "  return { id: user.id, email: user.email ?? null, name: user.name ?? null, username: user.username ?? null, role: user.role ?? null };",
    "}",
  ]);
}
function sessionViewContent(): string {
  return source([
    '"use client";',
    "",
    'import { authClient } from "@/lib/auth/client";',
    'import { hasPermission, hasRole, toSessionUser, type SessionUser } from "./permissions";',
    "",
    "export function useSessionView(): {",
    "  user: SessionUser | null;",
    "  isPending: boolean;",
    "  hasPermission: (permission: string) => boolean;",
    "  hasRole: (role: string) => boolean;",
    "} {",
    "  const session = authClient.useSession();",
    "  const user = toSessionUser(session.data?.user);",
    "  return {",
    "    user,",
    "    isPending: session.isPending,",
    "    hasPermission: (permission) => hasPermission(user, permission),",
    "    hasRole: (role) => hasRole(user, role),",
    "  };",
    "}",
  ]);
}
function sessionSyncContent(): string {
  return source([
    '"use client";',
    "",
    'import { useEffect } from "react";',
    'import { useSessionView } from "@/lib/auth/use-session-view";',
    'import { useAuthStore } from "@/stores/auth-store";',
    "",
    "export function SessionViewSync() {",
    "  const { user, isPending } = useSessionView();",
    "  const setSessionView = useAuthStore((state) => state.setSessionView);",
    "  useEffect(() => {",
    "    setSessionView(user, isPending);",
    "  }, [user, isPending, setSessionView]);",
    "  return null;",
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
    "",
    "export function SignOutButton() {",
    "  const router = useRouter();",
    "  const [pending, setPending] = useState(false);",
    "  return (",
    "    <Button",
    "      disabled={pending}",
    "      onClick={async () => {",
    "        setPending(true);",
    "        await authClient.signOut();",
    '        router.replace("/sign-in");',
    "        router.refresh();",
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
function authControlsContent(): string {
  return source([
    '"use client";',
    "",
    'import { useSessionView } from "@/lib/auth/use-session-view";',
    'import { SignOutButton } from "@/components/auth/sign-out-button";',
    "",
    "export function AuthControls() {",
    "  const { user, isPending } = useSessionView();",
    '  if (isPending) return <span aria-label="Checking login status" className="ng-account-state" role="status"><span aria-hidden="true" className="ng-account-icon">◌</span><span>Checking session…</span></span>;',
    '  if (!user) return <a aria-label="Signed out. Sign in" className="ng-account-state" href="/sign-in"><span aria-hidden="true" className="ng-account-icon">♙</span><span>Signed out · Sign in</span></a>;',
    "  return (",
    '    <div aria-label={`Signed in as ${user.name ?? user.email}${user.role ? `, role ${user.role}` : ""}`} className="ng-account-state" role="status">',
    '      <span aria-hidden="true" className="ng-account-icon ng-account-icon--signed-in">♙</span>',
    '      <span>{user.name ?? user.email} · {user.role ?? "no role"}</span>',
    "      <SignOutButton />",
    "    </div>",
    "  );",
    "}",
  ]);
}
function signInFormContent(config: FrontendAuthenticationContract): string {
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
    '      setError("Could not reach the authentication server. Check that the backend is running and that NEXT_PUBLIC_API_BASE_URL points to it.");',
    "    } finally {",
    "      setPending(false);",
    "    }",
    "  }",
    "  return (",
    '    <form className="ng-panel" onSubmit={submit}>',
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
    "  );",
    "}",
  ]);
}
function signUpFormContent(): string {
  return source([
    '"use client";',
    "",
    'import { useState, type FormEvent } from "react";',
    'import { useRouter } from "next/navigation";',
    'import { Button } from "@/components/ui/button";',
    'import { Input } from "@/components/ui/input";',
    'import { Notice } from "@/components/ui/notice";',
    'import { authClient } from "@/lib/auth/client";',
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
    '      const result = await authClient.signUp.email({ name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });',
    "      if (result.error) {",
    '        setError(result.error.message ?? "Sign-up failed.");',
    "        return;",
    "      }",
    "      await authClient.getSession();",
    '      router.replace("/");',
    "      router.refresh();",
    "    } catch {",
    '      setError("Could not reach the authentication server. Check that the backend is running and that NEXT_PUBLIC_API_BASE_URL points to it.");',
    "    } finally {",
    "      setPending(false);",
    "    }",
    "  }",
    "  return (",
    '    <form className="ng-panel" onSubmit={submit}>',
    '      {error ? <Notice tone="alert">{error}</Notice> : null}',
    '      <Input autoComplete="name" id="name" label="Name" name="name" required />',
    '      <Input autoComplete="email" id="email" label="Email" name="email" required type="email" />',
    `      <Input autoComplete="new-password" id="password" label="Password (at least ${ACCOUNT_POLICY.minPasswordLength} characters)" name="password" minLength={${ACCOUNT_POLICY.minPasswordLength}} required type="password" />`,
    '      <Button disabled={pending} type="submit">Create account</Button>',
    '      <p className="ng-panel-note">Already registered? <a className="ng-text-link" href="/sign-in">Sign in</a></p>',
    "    </form>",
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
    '          <p className="ng-lede">Browser sessions use HttpOnly cookies from the configured authentication plugin. This UI never stores session secrets.</p>',
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
    "- Set `NEXT_PUBLIC_API_BASE_URL` to the absolute backend URL.",
    "- `hasPermission` / `hasRole` are presentation helpers. Backend policies remain authoritative.",
  ]);
}
export function generateFrontendAuthFiles(
  context: FrontendRenderContext,
): readonly GeneratedFile[] {
  const config = authentication(context);
  const root = context.framework.codeRoot;
  const files = [
    { path: `${root}/lib/auth/client.ts`, content: authClientContent(context) },
    { path: `${root}/lib/auth/permissions.ts`, content: permissionsContent(config) },
    { path: `${root}/lib/auth/use-session-view.ts`, content: sessionViewContent() },
    { path: `${root}/lib/auth/README.md`, content: authReadme(config) },
    { path: `${root}/components/auth/sign-out-button.tsx`, content: signOutButtonContent() },
  ];
  files.push({
    path: `${root}/components/auth/session-view-sync.tsx`,
    content: sessionSyncContent(),
  });
  if (context.api.authentication) {
    files.push(
      { path: `${root}/components/auth/auth-controls.tsx`, content: authControlsContent() },
      { path: `${root}/components/auth/sign-in-form.tsx`, content: signInFormContent(config) },
      { path: `${root}/components/auth/sign-up-form.tsx`, content: signUpFormContent() },
      { path: `${root}/app/sign-in/page.tsx`, content: signInPageContent() },
      { path: `${root}/app/sign-up/page.tsx`, content: signUpPageContent() },
    );
  }
  return files;
}
