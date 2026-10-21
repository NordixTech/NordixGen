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
    get: vi.fn(async (key: string) => {
      const item = values.get(key);
      return item
        ? {
            body: new Response(item.body).body,
            size: item.body.length,
            httpMetadata: { contentType: item.type },
            httpEtag: '"test"',
          }
        : null;
    }),
    head: vi.fn(async (key: string) => (values.has(key) ? {} : null)),
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
    expect(
      (
        await app.request(`/documents/objects?key=${encodeURIComponent("docs/café.txt")}`, {
          method: "PUT",
          body: text,
          headers: { "content-type": "text/plain" },
        })
      ).status,
    ).toBe(201);
    expect(
      (await app.request("/documents/objects?key=second.txt", { method: "PUT", body: "second" }))
        .status,
    ).toBe(201);
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
  it("rejects cross-origin writes, invalid keys, oversized uploads and overwrites", async () => {
    const app = runtime();
    expect(
      (
        await app.request("/documents/objects?key=x", {
          method: "PUT",
          body: "x",
          headers: { origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    for (const key of ["../secret", "/absolute", "folder\\file", "bad\u0000"]) {
      expect((await app.request(`/documents/download?key=${encodeURIComponent(key)}`)).status).toBe(
        400,
      );
    }
    expect(
      (
        await app.request("/documents/objects?key=large", {
          method: "PUT",
          body: "tiny",
          headers: { "content-length": "20000000" },
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await app.request("/documents/objects?key=large", {
          method: "PUT",
          body: new Uint8Array(10 * 1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    expect(app.bucket.put).not.toHaveBeenCalled();
    expect(
      (await app.request("/documents/objects?key=x", { method: "PUT", body: "first" })).status,
    ).toBe(201);
    expect(
      (await app.request("/documents/objects?key=x", { method: "PUT", body: "second" })).status,
    ).toBe(409);
    expect(new TextDecoder().decode(app.values.get("x")?.body)).toBe("first");
    // The R2 conditional write is authoritative even if another writer races the preliminary head.
    app.bucket.head.mockResolvedValue(null);
    expect(
      (await app.request("/documents/objects?key=x", { method: "PUT", body: "third" })).status,
    ).toBe(409);
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
    expect(
      await generatedTypeErrors(sources, {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      }),
    ).toEqual([]);
  }, 20000);
});
