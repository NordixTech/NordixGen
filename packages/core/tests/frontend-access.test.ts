import { QueryClient, dehydrate } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import { identityBaseUrl, protectFrontendPage } from "../src/generation/frontend-access.js";
import { frontendRenderContext, generateFrontend } from "../src/generation/frontend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
const root = "apps/web/src";
function fixture(mode: "public" | "authenticated" | "mixed" = "authenticated") {
  const config = targetConfig();
  config.frontends[0].access = {
    mode,
    backend: "api",
    ...(mode === "mixed" ? { publicRoutes: ["/", "/customer/**"] } : {}),
  };
  // Use the resolved inventory rather than a parallel route interpretation in the renderer.
  if (mode === "mixed") config.frontends[0].access.publicRoutes = ["/"];
  const project = resolvedFixture(config);
  return { project, output: generateFrontend(project, "web") };
}
function guard(
  mode: "public" | "authenticated" | "mixed" = "authenticated",
  cookie: string | null = "test-cookie",
) {
  const { output } = fixture(mode);
  const fetchSession = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ session: { id: "session" }, user: { id: "user", role: "viewer" } }),
        { status: 200 },
      ),
  );
  const redirect = vi.fn((path: string) => {
    throw Error(`redirect:${path}`);
  });
  const files = output.virtualFileSystem.snapshot();
  // Bind request-local Next APIs and the external HTTP boundary; execute the generated guard unchanged.
  const load = generatedRuntime(
    files,
    {
      "server-only": {},
      react: { cache: (fn: unknown) => fn },
      "@/lib/backend/transport": {
        backendFetch: (_backend: string, path: string, init: RequestInit) =>
          fetchSession(`https://internal.invalid${path}`, init),
      },
      "next/headers": { headers: async () => new Headers(cookie ? { cookie } : {}) },
      "next/navigation": { redirect },
    },
    { fetch: fetchSession },
  );
  return {
    ...output,
    fetchSession,
    redirect,
    require: load(`${root}/lib/auth/server.ts`).requirePageSession as (
      path: string,
    ) => Promise<unknown>,
    requireIam: load(`${root}/lib/auth/server.ts`).requireIamAccess as (
      requiredPermission?: "iam:roles:manage",
    ) => Promise<void>,
    requireGuest: load(`${root}/lib/auth/server.ts`).requireGuestSession as () => Promise<void>,
  };
}
describe("verified server page access", () => {
  it("isolates server-prefetched data per identity and never hydrates failed or unauthorized reads", async () => {
    const files = fixture().output.virtualFileSystem.snapshot();
    let user: { id: string; role: string } | null = { id: "a", role: "viewer" };
    const backendFetch = vi.fn(async () => Response.json({ privateRecord: "only-a" }));
    const load = generatedRuntime(files, {
      "server-only": {},
      "@tanstack/react-query": { QueryClient, dehydrate },
      "next/headers": { headers: async () => new Headers({ cookie: `cookie-${user?.id}` }) },
      "@/lib/auth/server": { getInitialIdentity: async () => user },
      "@/lib/backend/transport": { backendFetch },
    });
    const prefetch = load(`${root}/lib/api/initial-data.ts`).initialData as (
      backend: string,
      path: string,
      key: string[],
      input: object,
      privateData: boolean,
    ) => Promise<ReturnType<typeof dehydrate>>;
    const first = await prefetch(
      "api",
      "/api/customers",
      ["nordixgen", "api", "customers", "list"],
      { query: { page: 1 } },
      true,
    );
    expect(first.queries[0].queryKey).toEqual([
      "nordixgen",
      "api",
      "customers",
      "list",
      ["private", "a", "viewer"],
      { query: { page: 1 } },
    ]);
    expect(backendFetch.mock.calls[0]).toEqual([
      "api",
      "/api/customers?page=1",
      expect.objectContaining({
        headers: { cookie: "cookie-a" },
        cache: "no-store",
        redirect: "error",
      }),
    ]);
    user = { id: "b", role: "viewer" };
    backendFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await prefetch("api", "/api/customers", ["list"], {}, true)).queries).toEqual([]);
    user = null;
    backendFetch.mockClear();
    expect((await prefetch("api", "/api/customers", ["list"], {}, true)).queries).toEqual([]);
    expect(backendFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).toContain("only-a");
  });
  it("protects audit history from user-assignment operators and rechecks current grants", async () => {
    for (const permission of ["*", "iam:roles:manage", "iam:users:manage-roles", "notes:read"]) {
      const f = guard("public");
      f.fetchSession
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ session: { id: "s" }, user: { id: "u", role: "admin" } })),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: [permission] })));
      if (permission === "*" || permission === "iam:roles:manage")
        await expect(f.requireIam("iam:roles:manage")).resolves.toBeUndefined();
      else await expect(f.requireIam("iam:roles:manage")).rejects.toThrow("redirect:/");
    }
    const guest = guard("public", null);
    await expect(guest.requireIam("iam:roles:manage")).rejects.toThrow("redirect:/sign-in");
  });
  it("redirects verified members away from account entry pages but admits guests and expired sessions", async () => {
    const member = guard();
    await expect(member.requireGuest()).rejects.toThrow("redirect:/");
    expect(member.fetchSession.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    const guest = guard("authenticated", null);
    await expect(guest.requireGuest()).resolves.toBeUndefined();
    expect(guest.fetchSession).not.toHaveBeenCalled();
    const expired = guard();
    expired.fetchSession.mockResolvedValueOnce(new Response("null"));
    await expect(expired.requireGuest()).resolves.toBeUndefined();
    const unavailable = guard();
    unavailable.fetchSession.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(unavailable.requireGuest()).rejects.toThrow("identity service is unavailable");
    const files = fixture().output.virtualFileSystem.snapshot();
    for (const route of ["sign-in", "sign-up"]) {
      const page = files[`${root}/app/${route}/page.tsx`];
      expect(page).toContain("await requireGuestSession()");
      expect(page).toContain('dynamic="force-dynamic"');
    }
  });
  it("uses a private Docker authority for server session and IAM checks without changing browser origins", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "http://localhost:8787");
    vi.stubEnv("AUTH_INTERNAL_BASE_URL", "http://backend-api:8787");
    try {
      const f = guard();
      f.fetchSession
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ session: { id: "s" }, user: { id: "u" } })),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: ["*"] })));
      await f.requireIam();
      expect(f.fetchSession.mock.calls.map((call) => String(call[0]))).toEqual([
        "https://internal.invalid/api/auth/iam/bootstrap",
        "https://internal.invalid/api/auth/iam/me",
      ]);
      expect(process.env.NEXT_PUBLIC_AUTH_BASE_URL).toBe("http://localhost:8787");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("checks IAM permissions on the server in public page mode and denies unavailable or insufficient authority", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "http://localhost:8787");
    try {
      for (const permission of ["*", "iam:roles:manage", "iam:users:manage-roles"]) {
        const f = guard("public");
        f.fetchSession
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ session: { id: "session" }, user: { id: "user" } })),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: [permission] })));
        await expect(f.requireIam()).resolves.toBeUndefined();
        expect(String(f.fetchSession.mock.calls[1][0])).toBe(
          "https://internal.invalid/api/auth/iam/me",
        );
        expect(f.fetchSession.mock.calls[1][1]).toMatchObject({
          cache: "no-store",
          headers: { cookie: "test-cookie" },
          redirect: "error",
        });
      }
      for (const response of [
        new Response("", { status: 403 }),
        new Response(JSON.stringify({ permissions: [] })),
      ]) {
        const f = guard();
        f.fetchSession
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ session: { id: "session" }, user: { id: "user" } })),
          )
          .mockResolvedValueOnce(response);
        await expect(f.requireIam()).rejects.toThrow("redirect:/");
      }
      const f = guard();
      f.fetchSession
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ session: { id: "session" }, user: { id: "user" } })),
        )
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
      await expect(f.requireIam()).rejects.toThrow("identity service is unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("reads pending, signed-in and signed-out presentation directly from Better Auth", () => {
    const files = fixture().output.virtualFileSystem.snapshot();
    let state: { isPending: boolean; data: { user: { id: string; role: string } } | null } = {
      isPending: true,
      data: null,
    };
    const load = generatedRuntime(files, {
      "@/lib/auth/client": { authClient: { useSession: () => state } },
      react: {
        createContext: () => ({}),
        createElement: () => null,
        useContext: () => undefined,
        useRef: () => ({ current: false }),
        useState: () => [null, () => {}],
        useEffect: () => {},
      },
      "@/lib/iam/client": { iamRequest: async () => null },
    });
    const view = load(`${root}/lib/auth/use-session-view.ts`).useSessionView as () => {
      user: { id: string } | null;
      isPending: boolean;
      hasRole(role: string): boolean;
    };
    expect(view()).toMatchObject({ user: null, isPending: true });
    state = { isPending: false, data: { user: { id: "verified", role: "viewer" } } };
    expect(view()).toMatchObject({ user: { id: "verified" }, isPending: true });
    expect(view().hasRole("viewer")).toBe(true);
    state = { isPending: false, data: null };
    expect(view()).toMatchObject({ user: null, isPending: false });
    expect(view().hasRole("viewer")).toBe(false);
  });
  it("synchronizes shared IAM access across concurrent useSessionView consumers", async () => {
    const files = fixture().output.virtualFileSystem.snapshot();
    const session = { isPending: false, data: { user: { id: "u-1", role: "member" } } };
    let calls = 0;
    let finish: (val: unknown) => void = () => {};
    const iamPromise = new Promise((resolve) => {
      finish = resolve;
    });
    const load = generatedRuntime(files, {
      "@/lib/auth/client": { authClient: { useSession: () => session } },
      react: {
        createContext: () => ({}),
        createElement: () => null,
        useContext: () => undefined,
        useRef: () => ({ current: false }),
        useState: (init: unknown) => [
          typeof init === "function" ? (init as () => unknown)() : init,
          () => {},
        ],
        useEffect: (fn: () => (() => void) | undefined) => {
          fn();
        },
      },
      "@/lib/iam/client": {
        iamRequest: async () => {
          calls += 1;
          return iamPromise;
        },
      },
    });
    const mod = load(`${root}/lib/auth/use-session-view.ts`) as {
      useSessionView: () => {
        user: unknown;
        isPending: boolean;
        hasPermission: (p: string) => boolean;
      };
    };
    const c1 = mod.useSessionView();
    const c2 = mod.useSessionView();
    expect(calls).toBe(1);
    expect(c1.isPending).toBe(true);
    expect(c2.isPending).toBe(true);
    finish({ id: "u-1", role: "admin", permissions: ["*"] });
    await iamPromise;
  });
  it("discards access responses from a previous user and reports unavailable identity without inventing denied permissions", async () => {
    const files = fixture().output.virtualFileSystem.snapshot();
    let state: {
      isPending: boolean;
      data: { user: { id: string; role: string } } | null;
      error?: Error;
    } = { isPending: false, data: { user: { id: "a", role: "member" } } };
    const pending: Array<(value: unknown) => void> = [];
    const load = generatedRuntime(files, {
      "@/lib/auth/client": {
        authClient: { useSession: () => ({ ...state, refetch: async () => {} }) },
      },
      react: {
        createContext: () => ({}),
        createElement: () => null,
        useContext: () => undefined,
        useRef: () => ({ current: false }),
        useState: () => [0, () => {}],
        useEffect: (fn: () => void) => fn(),
      },
      "@/lib/iam/client": { iamRequest: () => new Promise((resolve) => pending.push(resolve)) },
    });
    const view = load(`${root}/lib/auth/use-session-view.ts`).useSessionView as () => {
      user: { id: string } | null;
      error: string | null;
      isPending: boolean;
      hasPermission: (permission: string) => boolean;
    };
    view();
    state = { isPending: false, data: { user: { id: "b", role: "member" } } };
    view();
    pending[0]({ id: "a", role: "member", permissions: ["*"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view().hasPermission("iam:roles:manage")).toBe(false);
    pending[1]({ id: "b", role: "member", permissions: ["iam:users:manage-roles"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view().hasPermission("iam:users:manage-roles")).toBe(true);
    expect(view().hasPermission("iam:roles:manage")).toBe(false);
    state = { isPending: false, data: null, error: Error("503") };
    expect(view()).toMatchObject({
      user: null,
      isPending: false,
      error: "We could not verify your session. Please try again.",
    });
    expect(view().hasPermission("iam:users:manage-roles")).toBe(false);
  });
  it("never restores the initial server identity after sign-out or a failed session verification", () => {
    const files = fixture().output.virtualFileSystem.snapshot();
    const settled = { current: false };
    let state: { isPending: boolean; data: null; error?: Error } = { isPending: true, data: null };
    const initial = { id: "verified", role: "admin", permissions: ["*"] };
    const load = generatedRuntime(files, {
      "@/lib/auth/client": { authClient: { useSession: () => state } },
      react: {
        createContext: () => ({}),
        createElement: () => null,
        useContext: () => initial,
        useRef: () => settled,
        useState: () => [0, () => {}],
        useEffect: () => {},
      },
      "@/lib/iam/client": { iamRequest: async () => null },
    });
    const view = load(`${root}/lib/auth/use-session-view.ts`).useSessionView as () => {
      user: unknown;
      isPending: boolean;
      hasPermission: (permission: string) => boolean;
    };
    expect(view().hasPermission("iam:roles:manage")).toBe(true);
    state = { isPending: false, data: null };
    expect(view()).toMatchObject({ user: null, isPending: false });
    state = { isPending: true, data: null };
    expect(view().user).toBeNull();
    expect(view().hasPermission("iam:roles:manage")).toBe(false);
    state = { isPending: false, data: null, error: Error("unavailable") };
    expect(view().user).toBeNull();
  });
  it("retires the initial identity for newly mounted children after the provider has verified sign-out", () => {
    const files = fixture().output.virtualFileSystem.snapshot();
    const usable = { current: true };
    let pending = true;
    const element = vi.fn((_type: unknown, props: unknown) => props);
    const load = generatedRuntime(files, {
      "@/lib/auth/client": {
        authClient: { useSession: () => ({ isPending: pending, data: null }) },
      },
      react: {
        createContext: () => ({ Provider: {} }),
        createElement: element,
        useRef: () => usable,
      },
      "@/lib/iam/client": {},
    });
    const provider = load(`${root}/lib/auth/use-session-view.ts`)
      .InitialIdentityProvider as (props: { user: object; children: null }) => { value: unknown };
    const initial = { id: "old-user", role: "admin", permissions: ["*"] };
    expect(provider({ user: initial, children: null }).value).toBe(initial);
    pending = false;
    expect(provider({ user: initial, children: null }).value).toBeUndefined();
    pending = true;
    expect(provider({ user: initial, children: null }).value).toBeUndefined();
  });
  it("protects every resolved business page before rendering while retaining public auth entry pages", () => {
    const { output } = fixture();
    const files = output.virtualFileSystem.snapshot();
    for (const page of ["/", "/customer", "/invoice", "/api-explorer"]) {
      const file = files[`${root}/app${page === "/" ? "" : page}/page.tsx`];
      expect(file).toContain(`await requirePageSession(${JSON.stringify(page)})`);
      expect(file).toContain('dynamic="force-dynamic"');
    }
    for (const path of ["sign-in", "sign-up"])
      expect(files[`${root}/app/${path}/page.tsx`]).not.toContain("requirePageSession");
    expect(
      Object.keys(files).some(
        (path) => path.endsWith("auth-store.ts") || path.endsWith("session-view-sync.tsx"),
      ),
    ).toBe(false);
    expect(files[`${root}/lib/auth/use-session-view.ts`]).toContain("authClient.useSession()");
    const context = frontendRenderContext(fixture().project, "web");
    expect(() =>
      protectFrontendPage(context, { path: `${root}/app/page.tsx`, content: '"use client";' }),
    ).toThrow("named server component");
  });
  it("keeps public and explicit mixed pages accessible without calling identity", async () => {
    const publicGuard = guard("public", null);
    await expect(publicGuard.require("/invoice")).resolves.toBeNull();
    expect(publicGuard.fetchSession).not.toHaveBeenCalled();
    const mixed = guard("mixed", null);
    await expect(mixed.require("/")).resolves.toBeNull();
    await expect(mixed.require("/sign-in")).resolves.toBeNull();
    await expect(mixed.require("/invoice")).rejects.toThrow("redirect:/sign-in");
    await expect(mixed.require("/unknown")).rejects.toThrow("redirect:/sign-in");
  });
  it("verifies the cookie remotely with no caching and only a configured destination", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "http://localhost:8787");
    try {
      const f = guard();
      await expect(f.require("/invoice")).resolves.toMatchObject({ user: { id: "user" } });
      expect(String(f.fetchSession.mock.calls[0][0])).toBe(
        "https://internal.invalid/api/auth/iam/bootstrap",
      );
      expect(f.fetchSession.mock.calls[0][1]).toMatchObject({
        headers: { cookie: "test-cookie" },
        cache: "no-store",
        redirect: "error",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([null, { user: { id: "forged" } }, 401])(
    "rejects invalid, fabricated or expired session results %s",
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "http://localhost:8787");
      try {
        const f = guard();
        f.fetchSession.mockResolvedValue(
          new Response(JSON.stringify(value === 401 ? null : value), {
            status: value === 401 ? 401 : 200,
          }),
        );
        await expect(f.require("/invoice")).rejects.toThrow(
          value && value !== 401 ? "identity service is unavailable" : "redirect:/sign-in",
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it("fails closed on unavailable/malformed identity without redirect loops or exposing its cause", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "http://localhost:8787");
    try {
      const f = guard();
      for (const failure of [
        new Response("private upstream failure", { status: 503 }),
        new Response("invalid json"),
      ]) {
        f.fetchSession.mockResolvedValueOnce(failure);
        await expect(f.require("/invoice")).rejects.toThrow("identity service is unavailable");
      }
      f.fetchSession.mockRejectedValueOnce(Error("private token"));
      await expect(f.require("/invoice")).rejects.toThrow("identity service is unavailable");
      expect(f.redirect).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("ignores public backend URL variables and chooses only the resolved identity binding", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "https://untrusted.invalid");
    try {
      const f = guard();
      await f.require("/invoice");
      expect(String(f.fetchSession.mock.calls[0][0])).toBe(
        "https://internal.invalid/api/auth/iam/bootstrap",
      );
      const context = frontendRenderContext(fixture().project, "web");
      expect(identityBaseUrl(context)).not.toContain("process.env");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
