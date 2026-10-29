import { describe, expect, it, vi } from "vitest";
import { generateFrontend } from "../src/generation/frontend.js";
import { storageProxySource } from "../src/generation/storage-proxy.js";
import { createSecuredConfig, createValidConfig, resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";

function proxy() {
  return generatedRuntime({ "storage-proxy.ts": storageProxySource })("storage-proxy.ts")
    .proxyStorageDownload as (
    request: Request,
    env: Record<string, unknown>,
    bindings: Record<string, string>,
  ) => Promise<Response | null>;
}
const url =
  "https://web.example/api/backend/api/api/storage/documents/download?key=private%2Ffile.bin";
const bindings = { api: "BACKEND_API" };

describe("native authenticated storage proxy", () => {
  it("passes the native body and exact length without reading file chunks", async () => {
    const source = new Response("private bytes");
    const stream = source.body;
    const fetch = vi.fn(
      async () =>
        new Response(stream, {
          headers: {
            "Content-Length": "13",
            "Content-Disposition": "attachment",
            "Content-Type": "application/octet-stream",
            "Content-Security-Policy": "sandbox; default-src 'none'",
          },
        }),
    );
    const response = await proxy()(new Request(url), { BACKEND_API: { fetch } }, bindings);
    expect(response?.body).toBe(stream);
    expect(response?.bodyUsed).toBe(false);
    expect(response?.headers.get("content-length")).toBe("13");
    expect(response?.headers.get("content-security-policy")).toContain("sandbox");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(await response?.text()).toBe("private bytes");
  });

  it("forwards credentials to backend enforcement and removes spoofable trusted headers", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response(null, { status: 403 }));
    const request = new Request(url, {
      headers: {
        cookie: "session=verified-by-backend",
        range: "bytes=0-1023",
        "cf-connecting-ip": "203.0.113.1",
        "x-nordix-client-ip": "spoofed",
        "x-nordix-mcp-gateway": "spoofed",
        "x-forwarded-host": "evil.example",
      },
    });
    expect((await proxy()(request, { BACKEND_API: { fetch } }, bindings))?.status).toBe(403);
    const forwarded = fetch.mock.calls[0]?.[0] as unknown as Request;
    expect(forwarded.url).toBe(
      "https://web.example/api/storage/documents/download?key=private%2Ffile.bin",
    );
    expect(forwarded.headers.get("cookie")).toBe("session=verified-by-backend");
    expect(forwarded.headers.get("range")).toBe("bytes=0-1023");
    expect(forwarded.headers.get("x-nordix-client-ip")).toBe("203.0.113.1");
    expect(forwarded.headers.has("x-nordix-mcp-gateway")).toBe(false);
    expect(forwarded.headers.has("x-forwarded-host")).toBe(false);
  });

  it("keeps authorization failures and cannot expose unrelated backend routes", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response(null, { status: 401 }));
    const env = { BACKEND_API: { fetch } };
    expect((await proxy()(new Request(url), env, bindings))?.status).toBe(401);
    expect(
      (
        await proxy()(
          new Request(url.replace("/api/backend/api/", "/api/backend/unknown/")),
          env,
          bindings,
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await proxy()(
          new Request(url.replace("/api/backend/api/", "/api/backend/__proto__/")),
          env,
          bindings,
        )
      )?.status,
    ).toBe(404);
    expect(
      await proxy()(new Request("https://web.example/api/backend/api/mcp"), env, bindings),
    ).toBeNull();
    expect(await proxy()(new Request("https://web.example/order"), env, bindings)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await proxy()(new Request(url, { method: "POST" }), env, bindings))?.status).toBe(405);
    expect((await proxy()(new Request(url), {}, bindings))?.status).toBe(503);
  });

  it("returns an unavailable response before streaming when the binding fails", async () => {
    const fetch = vi.fn(async () => {
      throw Error("internal sensitive failure");
    });
    const response = await proxy()(new Request(url), { BACKEND_API: { fetch } }, bindings);
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("sensitive");
  });

  it("preserves upstream stream errors instead of closing an incomplete body successfully", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
      pull(controller) {
        controller.error(new Error("upstream stream interrupted"));
      },
    });
    const fetch = vi.fn(async () => new Response(body, { headers: { "Content-Length": "100" } }));
    const response = await proxy()(new Request(url), { BACKEND_API: { fetch } }, bindings);
    expect(response?.headers.get("content-length")).toBe("100");
    await expect(response?.arrayBuffer()).rejects.toThrow("upstream stream interrupted");
  });

  it("generates a custom Worker only for connected storage and preserves the Next fallback", async () => {
    const config = createSecuredConfig();
    const project = resolvedFixture({
      ...config,
      iac: { cloudflare: { r2_storage: { documents: {} } } },
      backends: config.backends.map((backend) => ({
        ...backend,
        iac: { r2_storage: ["documents"] },
      })),
    });
    const files = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
    expect(JSON.parse(files["apps/store-web/wrangler.jsonc"]).main).toBe("worker.ts");
    expect(files["apps/store-web/worker.ts"]).toContain("next.fetch(request,env,context)");
    expect(files["apps/store-web/worker.ts"]).toContain('"core-api":"BACKEND_CORE_API"');
    expect(
      await generatedTypeErrors({ "storage-proxy.ts": files["apps/store-web/storage-proxy.ts"] }),
    ).toEqual([]);
    const plain = generateFrontend(
      resolvedFixture(createValidConfig()),
      "store-web",
    ).virtualFileSystem.snapshot();
    expect(JSON.parse(plain["apps/store-web/wrangler.jsonc"]).main).toBe(".open-next/worker.js");
    expect(plain["apps/store-web/worker.ts"]).toBeUndefined();
  }, 15000);
});
