import { describe, expect, it, vi } from "vitest";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { cloudflareConfiguration } from "../src/generation/cloudflare.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { createValidConfig, resolvedFixture } from "./fixtures.js";
import { frontendRuntime } from "./frontend-runtime.js";
import { generatedRuntime } from "./generated-runtime.js";

function fixture() {
  const config = createValidConfig();
  return resolvedFixture({
    ...config,
    iac: { cloudflare: { r2_storage: { documents: {}, assets: { visibility: "public" } } } },
    backends: config.backends.map((backend) => ({
      ...backend,
      iac: { r2_storage: ["documents", "assets"] },
    })),
  });
}
describe("private Workers and native R2 storage", () => {
  it("permits shared buckets but rejects unknown references, colliding binding keys and owners", () => {
    const config = createValidConfig();
    const valid = {
      ...config,
      iac: { cloudflare: { r2_storage: { documents: {} } } },
      backends: config.backends.map((backend) => ({
        ...backend,
        iac: { r2_storage: ["documents"] },
      })),
    };
    expect(validateNordixConfig(valid).success).toBe(true);
    expect(
      validateNordixConfig({ ...valid, iac: { cloudflare: { r2_storage: { database_url: {} } } } })
        .success,
    ).toBe(false);
    expect(
      validateNordixConfig({
        ...valid,
        backends: valid.backends.map((backend) => ({
          ...backend,
          iac: { r2_storage: ["missing"] },
        })),
      }).success,
    ).toBe(false);
    expect(
      validateNordixConfig({
        ...valid,
        iac: { cloudflare: { r2_storage: { docs: {}, DOCS: {} } } },
      }).success,
    ).toBe(false);
    expect(
      validateNordixConfig({
        ...valid,
        iac: { repository: "missing", cloudflare: { r2_storage: {} } },
      }).success,
    ).toBe(false);
  });
  it("emits native bindings in each environment and never exposes backend or preview URLs", () => {
    const project = fixture();
    const generated = generateBackend(project, "core-api").virtualFileSystem.snapshot();
    const config = JSON.parse(generated["apps/api-core/wrangler.jsonc"]);
    for (const env of [config, config.env.staging, config.env.production]) {
      expect(env.workers_dev).toBe(false);
      expect(env.preview_urls).toBe(false);
      expect(env.routes).toBeUndefined();
      expect(env.r2_buckets).toHaveLength(2);
    }
    const web = cloudflareConfiguration("project", "web", true, ["api", "reports"]);
    expect(web.env.production.services?.map((item) => item.service)).toEqual([
      "project-web-production",
      "project-api-production",
      "project-reports-production",
    ]);
    expect(generated["apps/api-core/src/platform/database/create-route-dependencies.ts"]).toContain(
      "storage:StoragePorts",
    );
  });
  it("executes native upload/stream/existence/delete and signs bounded private download URLs", async () => {
    const files = generateBackend(fixture(), "core-api").virtualFileSystem.snapshot();
    const data = new Map<string, { value: Uint8Array; type: string }>();
    const bucket = {
      put: vi.fn(
        async (
          key: string,
          value: Uint8Array,
          options: { httpMetadata: { contentType: string } },
        ) => {
          data.set(key, { value, type: options.httpMetadata.contentType });
        },
      ),
      get: async (key: string) => {
        const item = data.get(key);
        return item
          ? {
              body: new Response(item.value).body,
              httpMetadata: { contentType: item.type },
              httpEtag: '"etag"',
              size: item.value.length,
            }
          : null;
      },
      head: async (key: string) => (data.has(key) ? {} : null),
      delete: async (key: string) => {
        data.delete(key);
      },
    };
    const load = generatedRuntime(files);
    const { CloudflareR2Adapter } = load(
      "apps/api-core/src/platform/storage/cloudflare-r2-adapter.ts",
    ) as {
      CloudflareR2Adapter: new (
        bucket: unknown,
        signing?: unknown,
        url?: string,
      ) => {
        upload(key: string, value: Uint8Array, type: string): Promise<void>;
        downloadStream(key: string): Promise<{ body: ReadableStream; contentType: string } | null>;
        exists(key: string): Promise<boolean>;
        delete(key: string): Promise<void>;
        getSignedUrl(key: string, seconds?: number): Promise<string>;
        getPublicUrl(key: string): Promise<string | null>;
      };
    };
    const adapter = new CloudflareR2Adapter(
      bucket,
      {
        accountId: "account",
        bucket: "private-documents",
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
      "https://assets.example.com/",
    );
    await adapter.upload("invoice a.pdf", new TextEncoder().encode("invoice"), "application/pdf");
    expect(await adapter.exists("invoice a.pdf")).toBe(true);
    const download = await adapter.downloadStream("invoice a.pdf");
    expect(await new Response(download?.body).text()).toBe("invoice");
    expect(download?.contentType).toBe("application/pdf");
    expect(await adapter.getPublicUrl("invoice a.pdf")).toBe(
      "https://assets.example.com/invoice%20a.pdf",
    );
    const signed = new URL(await adapter.getSignedUrl("invoice a.pdf", 60));
    expect(signed.host).toBe("account.r2.cloudflarestorage.com");
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(signed.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.toString()).not.toContain("secret");
    await expect(adapter.getSignedUrl("file", 0)).rejects.toThrow("Expiry");
    await expect(adapter.getSignedUrl("../private")).rejects.toThrow("Invalid");
    const unsigned = new CloudflareR2Adapter(bucket);
    expect(await unsigned.getPublicUrl("file")).toBeNull();
    await expect(unsigned.getSignedUrl("file")).rejects.toThrow("not configured");
    await adapter.delete("invoice a.pdf");
    expect(await adapter.exists("invoice a.pdf")).toBe(false);
    expect(await adapter.downloadStream("invoice a.pdf")).toBeNull();
    const factory = load("apps/api-core/src/platform/storage/create-storage.ts").createStorage as (
      env: unknown,
    ) => Record<string, unknown>;
    expect(Object.keys(factory({ DOCUMENTS: bucket, ASSETS: bucket }))).toEqual([
      "assets",
      "documents",
    ]);
    expect(
      Object.keys(
        factory({
          DOCUMENTS: bucket,
          ASSETS: bucket,
          R2_ACCOUNT_ID: "a",
          R2_ACCESS_KEY_ID: "i",
          R2_SECRET_ACCESS_KEY: "s",
          R2_BUCKETS: '{"documents":"d"}',
        }),
      ),
    ).toHaveLength(2);
  });
  it("forwards only configured services, preserves query/body/cookies, streams responses and fails closed", async () => {
    const files = generateFrontend(fixture(), "store-web").virtualFileSystem.snapshot();
    const service = vi.fn(
      async (request: Request) =>
        new Response(
          `${request.method}:${new URL(request.url).pathname}${new URL(request.url).search}:${await request.text()}`,
          { headers: { "Set-Cookie": "session=opaque; HttpOnly" } },
        ),
    );
    const externalFetch = vi.fn();
    const load = frontendRuntime(
      files,
      "apps/store-web/src",
      {
        "server-only": {},
        "@opennextjs/cloudflare": {
          getCloudflareContext: async () => ({ env: { BACKEND_CORE_API: { fetch: service } } }),
        },
      },
      { fetch: externalFetch },
    );
    const transport = load("apps/store-web/src/lib/backend/transport.ts") as {
      proxyBackend(backend: string, request: Request, path: string): Promise<Response>;
      backendFetch(backend: string, path: string, init?: RequestInit): Promise<Response>;
    };
    const result = await transport.proxyBackend(
      "core-api",
      new Request("https://front.example/api/backend/core-api/api/files?q=a", {
        method: "POST",
        body: "data",
        headers: { cookie: "session=opaque", origin: "https://front.example" },
      }),
      "/api/files",
    );
    expect(await result.text()).toBe("POST:/api/files?q=a:data");
    expect(result.headers.get("set-cookie")).toContain("HttpOnly");
    expect(service.mock.calls[0][0].headers.get("cookie")).toBe("session=opaque");
    expect(externalFetch).not.toHaveBeenCalled();
    expect(
      (await transport.proxyBackend("unknown", new Request("https://front.example/"), "/api/files"))
        .status,
    ).toBe(503);
    await expect(transport.backendFetch("core-api", "//evil.example")).rejects.toThrow("Invalid");
    const missing = frontendRuntime(
      files,
      "apps/store-web/src",
      {
        "server-only": {},
        "@opennextjs/cloudflare": {
          getCloudflareContext: async () => {
            throw Error("unavailable");
          },
        },
      },
      { fetch: externalFetch, process: { env: { NODE_ENV: "production" } } },
    )("apps/store-web/src/lib/backend/transport.ts") as typeof transport;
    await expect(missing.backendFetch("core-api", "/health")).rejects.toThrow("binding");
    expect(externalFetch).not.toHaveBeenCalled();
  });
  it("uses the explicit local transport without starting a Cloudflare emulator", async () => {
    const files = generateFrontend(fixture(), "store-web").virtualFileSystem.snapshot();
    const context = vi.fn(() => {
      throw Error("Cloudflare context must not be initialized");
    });
    const localFetch = vi.fn(async () => new Response("local backend"));
    const transport = frontendRuntime(
      files,
      "apps/store-web/src",
      { "server-only": {}, "@opennextjs/cloudflare": { getCloudflareContext: context } },
      {
        fetch: localFetch,
        process: {
          env: {
            NODE_ENV: "production",
            NORDIX_LOCAL_RUNTIME: "1",
            BACKEND_CORE_API_INTERNAL_URL: "http://127.0.0.1:8787",
          },
        },
      },
    )("apps/store-web/src/lib/backend/transport.ts") as {
      backendFetch(backend: string, path: string): Promise<Response>;
    };
    expect(await (await transport.backendFetch("core-api", "/health")).text()).toBe(
      "local backend",
    );
    expect(context).not.toHaveBeenCalled();
    expect(new URL((localFetch.mock.calls[0][0] as Request).url).origin).toBe(
      "http://127.0.0.1:8787",
    );
  });
});
