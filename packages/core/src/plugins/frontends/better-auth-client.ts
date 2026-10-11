import type {
  FrontendAuthenticationContract,
  FrontendGeneratorPlugin,
  FrontendPluginContributionContext,
} from "../frontend-contracts.js";
import { frontendRootShellFiles } from "./root-shell.js";

function source(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

function authentication(
  context: FrontendPluginContributionContext,
): FrontendAuthenticationContract {
  const contract = context.api.authentication;
  if (!contract) {
    throw new Error(
      "Better Auth frontend integration requires a connected backend authentication plugin.",
    );
  }
  return contract;
}

function authClientContent(context: FrontendPluginContributionContext): string {
  const config = authentication(context);
  const apiBaseUrl =
    context.framework.conventions.publicApiBaseUrlExpression ??
    '(globalThis as typeof globalThis & { __NORDIX_API_BASE_URL__?: string }).__NORDIX_API_BASE_URL__ ?? ""';
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
    "  const grants = rolePermissions[role] ?? [];",
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
    ...(username
      ? [
          '    const result = mode === "username"',
          '      ? await authClient.signIn.username({ username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") })',
          '      : await authClient.signIn.email({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });',
        ]
      : [
          '    const result = await authClient.signIn.email({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });',
        ]),
    "    setPending(false);",
    "    if (result.error) {",
    '      setError(result.error.message ?? "Sign-in failed.");',
    "      return;",
    "    }",
    '    router.replace("/");',
    "    router.refresh();",
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

function authReadme(config: FrontendAuthenticationContract): string {
  return source([
    "# Frontend authentication",
    "",
    `This frontend uses the ${config.plugin} session from backend \`${config.backend}\`.`,
    "",
    "- Sign-in, sign-out, and session refresh call the backend authentication HTTP API.",
    "- The browser stores the session in HttpOnly cookies. Do not copy tokens into Zustand, React state, or localStorage.",
    "- Add this frontend origin to the backend `AUTH_TRUSTED_ORIGINS` list so credentialed requests and CSRF origin checks succeed.",
    "- Set `NEXT_PUBLIC_API_BASE_URL` to the absolute backend URL.",
    "- `hasPermission` / `hasRole` are presentation helpers. Backend policies remain authoritative.",
  ]);
}

export const betterAuthFrontendPlugin: FrontendGeneratorPlugin = {
  descriptor: {
    id: "better-auth",
    version: "1.0.0",
    role: "authentication",
    provides: [
      "authentication:better-auth",
      "authentication:session",
      "authentication:permission-view",
    ],
    requires: [
      {
        capability: "framework:react",
        description: "The Better Auth browser client currently generates React hooks.",
      },
    ],
    dependencies: { "better-auth": "^1.7.7" },
  },
  contribute(context) {
    const config = authentication(context);
    const root = context.framework.codeRoot;
    const files = [
      { path: `${root}/lib/auth/client.ts`, content: authClientContent(context) },
      { path: `${root}/lib/auth/permissions.ts`, content: permissionsContent(config) },
      { path: `${root}/lib/auth/use-session-view.ts`, content: sessionViewContent() },
      { path: `${root}/lib/auth/README.md`, content: authReadme(config) },
      { path: `${root}/components/auth/sign-out-button.tsx`, content: signOutButtonContent() },
      ...frontendRootShellFiles(context, "authentication"),
    ];
    if (context.availableCapabilities.has("client-state:zustand")) {
      files.push({
        path: `${root}/components/auth/session-view-sync.tsx`,
        content: sessionSyncContent(),
      });
    }
    if (context.frontend.authUI) {
      files.push(
        { path: `${root}/components/auth/sign-in-form.tsx`, content: signInFormContent(config) },
        { path: `${root}/app/sign-in/page.tsx`, content: signInPageContent() },
      );
    }
    return files;
  },
};
