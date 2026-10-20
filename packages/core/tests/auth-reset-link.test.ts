import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { generateFrontend } from "../src/generation/frontend.js";
import { createSecuredConfig, resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

function frontend() {
  const config = createSecuredConfig();
  Object.assign(config.backends[0].authentication, {
    methods: ["email-password", "phone-number", "username-password"],
  });
  return generateFrontend(resolvedFixture(config), "store-web").virtualFileSystem.snapshot();
}

describe("reset link page gate", () => {
  it("checks the authoritative callback without following redirects or caching a token", async () => {
    const files = frontend();
    const source = Object.entries(files).find(([path]) => path.endsWith("/reset-link.ts"))?.[1];
    expect(source).toBeDefined();
    const backendFetch = vi.fn();
    const check = generatedRuntime(
      { "reset-link.ts": source as string },
      { "@/lib/backend/transport": { backendFetch } },
    )("reset-link.ts").checkResetLink as (token: string, origin: string) => Promise<string>;
    const origin = "https://demo.example";
    backendFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: `${origin}/reset-password?token=valid` },
      }),
    );
    expect(await check("valid", origin)).toBe("valid");
    expect(backendFetch).toHaveBeenCalledWith(
      "core-api",
      "/api/auth/reset-password/valid?callbackURL=https%3A%2F%2Fdemo.example%2Freset-password",
      expect.objectContaining({
        cache: "no-store",
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
      origin,
    );
    for (const location of [
      `${origin}/reset-password?error=INVALID_TOKEN`,
      `${origin}/reset-password?token=different`,
      "https://outside.example/reset-password?token=valid",
      `${origin}/other-page?token=valid`,
    ]) {
      backendFetch.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location } }),
      );
      expect(await check("valid", origin)).toBe("invalid");
    }
    backendFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await check("valid", origin)).toBe("invalid");
    for (const status of [429, 503]) {
      backendFetch.mockResolvedValueOnce(new Response(null, { status }));
      expect(await check("valid", origin)).toBe("unavailable");
    }
    backendFetch.mockRejectedValueOnce(new Error("network"));
    expect(await check("valid", origin)).toBe("unavailable");
  });

  it("emits valid account components for email, username, phone and company configurations", () => {
    for (const methods of [
      ["email-password"],
      ["phone-number"],
      ["email-password", "username-password", "phone-number"],
    ]) {
      const config = createSecuredConfig();
      Object.assign(config.backends[0].authentication, { methods, identityProviders: [] });
      const files = generateFrontend(
        resolvedFixture(config),
        "store-web",
      ).virtualFileSystem.snapshot();
      for (const [path, content] of Object.entries(files).filter(([path]) =>
        /\.tsx?$/.test(path),
      )) {
        const result = ts.transpileModule(content, {
          reportDiagnostics: true,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        });
        expect(
          result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error),
          path,
        ).toEqual([]);
      }
    }
  });
});
