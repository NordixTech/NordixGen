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
    requireIam: load(`${root}/lib/auth/server.ts`).requireIamAccess as () => Promise<void>,
  };
}
describe("verified server page access", () => {
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
        "http://backend-api:8787/api/auth/get-session",
        "http://backend-api:8787/api/iam/me",
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
        expect(String(f.fetchSession.mock.calls[1][0])).toBe("http://localhost:8787/api/iam/me");
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
      react: { useState: () => [null, () => {}], useEffect: () => {} },
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
        "http://localhost:8787/api/auth/get-session",
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
  it("refuses redirecting or credential-bearing identity URLs and never silently selects a different backend", async () => {
    try {
      for (const base of [
        "",
        "file:///tmp/private",
        "https://user:password@example.test",
        "https://example.test/path",
        "https://example.test/?redirect=other",
      ]) {
        vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", base);
        const f = guard();
        await expect(f.require("/invoice")).rejects.toThrow("identity service is unavailable");
        expect(f.fetchSession).not.toHaveBeenCalled();
      }
      const context = frontendRenderContext(fixture().project, "web");
      expect(
        identityBaseUrl({
          ...context,
          frontend: { ...context.frontend, connections: ["api", "public-api"] },
        }),
      ).not.toContain("NEXT_PUBLIC_API_BASE_URL");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
