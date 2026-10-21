import { Hono } from "hono";
import * as httpException from "hono/http-exception";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { createSecuredConfig, createValidConfig, resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";

function fixture(auth = true) {
  const config = auth ? createSecuredConfig() : createValidConfig();
  return resolvedFixture({
    ...config,
    iac: { cloudflare: { r2_storage: { documents: {}, assets: { visibility: "public" } } } },
    backends: config.backends.map((backend) => ({
      ...backend,
      iac: { r2_storage: ["documents", "assets"] },
    })),
  });
}
function runtime() {
  const project = fixture();
  const files = generateBackend(project, "core-api").virtualFileSystem.snapshot();
  const values = new Map<string, { body: Uint8Array; type: string }>();
  const bucket = {
    list: vi.fn(async ({ cursor }: { cursor?: string }) => ({
      objects: [...values].slice(cursor ? 1 : 0, cursor ? 2 : 1).map(([key, value]) => ({
        key,
        size: value.body.length,
        uploaded: new Date("2026-10-21T00:00:00Z"),
        etag: '"test"',
      })),
      truncated: !cursor && values.size > 1,
      cursor: !cursor && values.size > 1 ? "next" : undefined,
    })),
    put: vi.fn(
      async (
        key: string,
        body: Uint8Array,
        options: { httpMetadata: { contentType: string }; onlyIf?: unknown },
      ) => {
        if (options.onlyIf && values.has(key)) return null;
        values.set(key, { body, type: options.httpMetadata.contentType });
        return {};
      },
    ),
    get: vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
      const item = values.get(key);
      return item
        ? {
            body: new Response(
              options?.range
                ? item.body.slice(options.range.offset, options.range.offset + options.range.length)
                : item.body,
            ).body,
            size: item.body.length,
            httpMetadata: { contentType: item.type },
            httpEtag: '"test"',
          }
        : null;
    }),
    head: vi.fn(async (key: string) =>
      values.has(key)
        ? {
            size: values.get(key)?.body.length ?? 0,
            etag: "test",
            httpEtag: '"test"',
            uploaded: new Date("2026-10-21T00:00:00Z"),
          }
        : null,
    ),
    delete: vi.fn(),
  };
  const load = generatedRuntime(files, { hono: { Hono }, "hono/http-exception": httpException });
  const create = load("apps/api-core/src/platform/storage/routes.ts").createStorageRoutes as (
    verify: () => Promise<unknown>,
    trusted: (origin: string) => boolean,
  ) => Hono;
  let principal: { id: string; permissions: string[] } | null = { id: "user", permissions: ["*"] };
  const app = create(
    async () => principal,
    (origin) => origin === "https://web.example",
  );
  const env = {
    DOCUMENTS: bucket,
    ASSETS: bucket,
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKETS: JSON.stringify({ documents: "private-docs", assets: "public-assets" }),
  };
  const request = (path: string, init: RequestInit = {}, settings = env) =>
    app.request(
      `https://api.example/api/storage${path}`,
      { ...init, headers: { origin: "https://web.example", ...init.headers } },
      settings,
    );
  return {
    files,
    project,
    bucket,
    values,
    env,
    request,
    setPrincipal: (next: typeof principal) => {
      principal = next;
    },
  };
}
describe("generated R2 document manager", () => {
  it("prepares initial storage metadata per verified identity without sharing listings or hydrating failed reads", async () => {
    const files = generateFrontend(fixture(), "store-web").virtualFileSystem.snapshot();
    const root = "apps/store-web/src";
    let user: { id: string; role: string; permissions: string[] } | null = {
      id: "a",
      role: "admin",
      permissions: ["*"],
    };
    const backendFetch = vi.fn(async (_backend: string, path: string) =>
      Response.json(
        path.endsWith("/instances")
          ? { instances: [{ key: "documents", canRead: true }] }
          : { objects: [{ key: "only-a.txt" }] },
      ),
    );
    const load = generatedRuntime(
      { ...files, "@/lib/api/cache": files[`${root}/lib/api/cache.ts`] },
      {
        "server-only": {},
        "@tanstack/react-query": {},
        "next/headers": { headers: async () => new Headers({ cookie: `cookie-${user?.id}` }) },
        "@/lib/backend/transport": { backendFetch },
        "@/lib/auth/server": { getInitialIdentity: async () => user },
      },
    );
    const initial = load(`${root}/lib/storage/initial-data.ts`).initialStorage as () => Promise<
      { scope: string; listing?: { objects: { key: string }[] } } | undefined
    >;
    const a = await initial();
    expect(a?.listing?.objects[0].key).toBe("only-a.txt");
    expect(a?.scope).toContain('"a"');
    expect(backendFetch.mock.calls[1]).toEqual([
      "core-api",
      "/api/storage/documents/objects?prefix=",
      expect.objectContaining({ headers: { cookie: "cookie-a" }, cache: "no-store" }),
    ]);
    user = { id: "b", role: "guest", permissions: [] };
    backendFetch.mockResolvedValueOnce(Response.json({ instances: [] }));
    const b = await initial();
    expect(b?.scope).toContain('"b"');
    expect(b?.listing).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain("only-a.txt");
    backendFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await initial()).toBeUndefined();
    user = null;
    backendFetch.mockClear();
    expect(await initial()).toBeUndefined();
    expect(backendFetch).not.toHaveBeenCalled();
  });
  it("serves bounded ranges with validators and checks permission before accessing R2", async () => {
    const app = runtime();
    app.values.set("range.txt", {
      body: new TextEncoder().encode("0123456789"),
      type: "text/plain",
    });
    const get = (range: string, ifRange?: string) =>
      app.request("/documents/download?key=range.txt", {
        headers: { range, ...(ifRange ? { "if-range": ifRange } : {}) },
      });
    for (const [range, text, contentRange] of [
      ["bytes=2-5", "2345", "bytes 2-5/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
      ["bytes=8-", "89", "bytes 8-9/10"],
      ["bytes=8-99", "89", "bytes 8-9/10"],
    ]) {
      const response = await get(range);
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(contentRange);
      expect(response.headers.get("content-length")).toBe(String(text.length));
      expect(await response.text()).toBe(text);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect((await get("bytes=0-1", '"test"')).status).toBe(206);
    for (const validator of ['"old"', 'W/"test"', "Wed, 20 Oct 2021 00:00:00 GMT"]) {
      const response = await get("bytes=0-1", validator);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("0123456789");
    }
    for (const range of [
      "bytes=10-",
      "bytes=-0",
      "bytes=5-2",
      "bytes=999999999999999999999-",
      "garbage",
    ]) {
      const response = await get(range);
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
    }
    expect((await get("bytes=0-1,4-5")).status).toBe(200);
    app.bucket.head.mockClear();
    app.bucket.get.mockClear();
    app.setPrincipal(null);
    expect((await get("bytes=0-1")).status).toBe(401);
    app.setPrincipal({ id: "revoked", permissions: [] });
    expect((await get("bytes=0-1")).status).toBe(403);
    expect(app.bucket.head).not.toHaveBeenCalled();
    expect(app.bucket.get).not.toHaveBeenCalled();
  });
  it("restarts with the full current object when a file changes during a ranged read", async () => {
    const app = runtime();
    app.values.set("range.txt", {
      body: new TextEncoder().encode("new version"),
      type: "text/plain",
    });
    app.bucket.get.mockResolvedValueOnce({ size: 11, httpEtag: '"new"' } as never);
    const response = await app.request("/documents/download?key=range.txt", {
      headers: { range: "bytes=0-1" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-range")).toBeNull();
    expect(await response.text()).toBe("new version");
    expect(app.bucket.get).toHaveBeenCalledTimes(2);
  });
  it("generates conditional navigation and reserves the platform surface", () => {
    const project = fixture();
    const files = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
    expect(project.frontends["store-web"].storageBackends).toEqual(["core-api"]);
    expect(files["apps/store-web/src/app/r2/page.tsx"]).toContain('requirePageSession("/r2")');
    expect(files["apps/store-web/src/components/layout/app-shell.tsx"]).toContain(
      '"label":"Instancias R2"',
    );
    expect(project.backends["core-api"].identity?.permissions).toContain("storage:documents:read");
    const plain = generateFrontend(
      resolvedFixture(createValidConfig()),
      "store-web",
    ).virtualFileSystem.snapshot();
    expect(plain["apps/store-web/src/app/r2/page.tsx"]).toBeUndefined();
    const config = createSecuredConfig();
    Object.assign(config.backends[0], { iac: { r2_storage: ["documents"] } });
    config.endpoints.push({
      backend: "core-api",
      entity: "Customer",
      method: "GET",
      path: "/api/storage/instances",
      operationId: "reserved",
    });
    expect(
      validateNordixConfig({
        ...config,
        iac: { cloudflare: { r2_storage: { documents: {} } } },
      }).diagnostics.some((d) => d.code === "PLATFORM_ROUTE_RESERVED"),
    ).toBe(true);
  });
  it("filters instances using current grants and never equates public visibility with access", async () => {
    const app = runtime();
    app.setPrincipal(null);
    expect((await app.request("/instances")).status).toBe(401);
    app.setPrincipal({ id: "u", permissions: [] });
    expect(await (await app.request("/instances")).json()).toEqual({ instances: [] });
    expect((await app.request("/assets/objects")).status).toBe(403);
    app.setPrincipal({ id: "u", permissions: ["storage:documents:write"] });
    const list = await (await app.request("/instances")).json();
    expect(list.instances).toHaveLength(1);
    expect(list.instances[0]).toMatchObject({
      key: "documents",
      visibility: "private",
      canRead: false,
      canUpload: true,
    });
    expect((await app.request("/documents/objects")).status).toBe(403);
    app.setPrincipal({ id: "u", permissions: ["storage:assets:read"] });
    const publicList = await (await app.request("/instances")).json();
    expect(publicList.instances[0].visibility).toBe("public");
  });
  it("uploads exact bytes, pages objects, streams downloads and creates bounded signed links", async () => {
    const app = runtime();
    const text = "Nordix document: café, 日本語";
    app.values.set("docs/café.txt", { body: new TextEncoder().encode(text), type: "text/plain" });
    app.values.set("second.txt", { body: new TextEncoder().encode("second"), type: "text/plain" });
    const listing = await (await app.request("/documents/objects")).json();
    expect(listing.objects[0].key).toBe("docs/café.txt");
    expect(listing.cursor).toBe("next");
    const next = await (await app.request("/documents/objects?cursor=next")).json();
    expect(next.objects[0].key).toBe("second.txt");
    expect(next.cursor).toBeUndefined();
    const download = await app.request(
      `/documents/download?key=${encodeURIComponent("docs/café.txt")}`,
    );
    expect(await download.text()).toBe(text);
    expect(download.headers.get("content-disposition")).toContain("caf%C3%A9.txt");
    expect(download.headers.get("content-security-policy")).toContain("sandbox");
    const signed = await (
      await app.request("/documents/signed-url", {
        method: "POST",
        body: JSON.stringify({ key: "docs/café.txt" }),
      })
    ).json();
    expect(new URL(signed.url).host).toBe("account.r2.cloudflarestorage.com");
    expect(new URL(signed.url).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(JSON.stringify(signed)).not.toContain("secret");
  });
  it("authorizes direct uploads with bounded signed metadata and current write grants", async () => {
    const app = runtime();
    const authorize = (body: unknown, headers: Record<string, string> = {}) =>
      app.request("/documents/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const metadata = { key: "folder/café.txt", size: 50 * 1024 * 1024, contentType: "text/plain" };
    const response = await authorize(metadata);
    expect(response.status).toBe(200);
    const grant = await response.json();
    expect(grant).toMatchObject({
      key: metadata.key,
      size: metadata.size,
      method: "PUT",
      expiresIn: 300,
      headers: { "content-type": "text/plain", "if-none-match": "*" },
    });
    expect(new URL(grant.url).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host;if-none-match",
    );
    expect(new URL(grant.url).pathname).toBe("/private-docs/folder/caf%C3%A9.txt");
    expect(JSON.stringify(grant)).not.toContain("secret");
    expect(app.bucket.put).not.toHaveBeenCalled();
    expect(app.values.size).toBe(0);
    expect((await authorize(metadata, { origin: "https://evil.example" })).status).toBe(403);
    app.setPrincipal(null);
    expect((await authorize(metadata)).status).toBe(401);
    app.setPrincipal({ id: "u", permissions: ["storage:documents:read"] });
    expect((await authorize(metadata)).status).toBe(403);
    app.setPrincipal({ id: "u", permissions: ["storage:documents:write"] });
    expect((await authorize(metadata)).status).toBe(200);
    for (const change of [
      { size: -1 },
      { size: 1.5 },
      { size: "1" },
      { key: "../bad" },
      { contentType: "bad\r\nvalue" },
    ])
      expect((await authorize({ ...metadata, ...change })).status).toBe(400);
    expect((await authorize({ ...metadata, size: 100 * 1024 * 1024 + 1 })).status).toBe(413);
    expect((await authorize({ ...metadata, key: "a".repeat(5000) })).status).toBe(413);
    app.values.set(metadata.key, { body: new Uint8Array(1), type: "text/plain" });
    expect((await authorize(metadata)).status).toBe(409);
    expect(
      (await app.request("/documents/objects?key=x", { method: "PUT", body: "file" })).status,
    ).toBe(410);
    expect(app.bucket.put).not.toHaveBeenCalled();
    const unavailable = await app.request(
      "/documents/upload-url",
      { method: "POST", body: JSON.stringify(metadata) },
      { ...app.env, R2_SECRET_ACCESS_KEY: "" },
    );
    expect(unavailable.status).toBe(503);
  });
  it("reports absent signing configuration and missing objects without exposing secrets", async () => {
    const app = runtime();
    expect((await app.request("/unknown/objects")).status).toBe(404);
    expect((await app.request("/documents/download?key=missing")).status).toBe(404);
    const response = await app.request(
      "/documents/signed-url",
      { method: "POST", body: '{"key":"missing"}' },
      { ...app.env, R2_SECRET_ACCESS_KEY: "" },
    );
    expect(response.status).toBe(503);
    expect(
      (await app.request("/documents/signed-url", { method: "POST", body: '{"key":"missing"}' }))
        .status,
    ).toBe(404);
    expect(
      (await app.request("/documents/signed-url", { method: "POST", body: "invalid" })).status,
    ).toBe(400);
  });
  it("compiles generated storage adapters, routes and browser against actual dependency types", async () => {
    const { files } = runtime();
    const sources = Object.fromEntries(
      Object.entries(files)
        .filter(
          ([path]) =>
            path.includes("/platform/storage/") ||
            path.includes("/application/ports/storage-port") ||
            path.endsWith("/http/problem-details.ts"),
        )
        .map(([path, content]) => [path.split("/src/")[1], content]),
    );
    const browser = generateFrontend(fixture(), "store-web").virtualFileSystem.snapshot()[
      "apps/store-web/src/components/storage/storage-browser.tsx"
    ];
    sources["storage-browser.tsx"] = browser;
    sources["frontend-boundaries.d.ts"] =
      `declare module "@/lib/auth/use-session-view" {export function useSessionView():{isPending:boolean;user:{id:string;role?:string|null;permissions?:readonly string[]}|null};}
declare module "@/lib/api/cache" {export function sessionCacheIdentity(session:{isPending:boolean;user:{id:string;role?:string|null;permissions?:readonly string[]}|null}):string;}`;
    expect(
      await generatedTypeErrors(sources, {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      }),
    ).toEqual([]);
  }, 20000);
});
