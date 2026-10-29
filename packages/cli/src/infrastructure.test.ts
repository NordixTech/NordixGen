import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseNordixYaml,
  resolveProjectYaml,
  stringifyNordixYaml,
} from "@nordix-tech/nordixgen-core";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeploymentManifest } from "./deployment-model.js";
import { reviewWebhookSource } from "./infrastructure-events.js";
import { InfrastructureRunner, infrastructureStage, stateKey } from "./infrastructure-runner.js";
import { prepareInfrastructure } from "./infrastructure-setup.js";
import { infrastructureFiles, infrastructureManifest } from "./infrastructure.js";
import { createStarterConfiguration } from "./orchestrator.js";

const mocks = vi.hoisted(() => ({ s3: vi.fn() }));
vi.mock("aws4fetch", () => ({
  AwsClient: class {
    fetch = mocks.s3;
  },
}));
vi.mock("execa", () => ({ execa: vi.fn() }));
let directory: string;
let manifest: DeploymentManifest;
const objects = new Map<string, string>();
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "nordix-infra-test-"));
  objects.clear();
  manifest = {
    version: 1,
    project: "demo",
    repository: "app",
    applications: [],
    infrastructure: { owner: true, stateBucket: "demo-state", statePrefix: "demo", backends: {} },
  };
  for (const [name, value] of Object.entries({
    TOFU_BIN: "tofu",
    R2_STATE_ACCESS_KEY_ID: "state-id",
    R2_STATE_SECRET_ACCESS_KEY: "state-secret",
    R2_STATE_BUCKET: "demo-state",
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "admin",
    INFRA_GITHUB_REPOSITORY: "owner/repo",
    INFRA_GITHUB_TOKEN: "github",
  }))
    vi.stubEnv(name, value);
  vi.stubEnv("WORKERS_CI_BRANCH", "");
  vi.stubEnv("WORKERS_CI_COMMIT_SHA", "commit");
  mocks.s3.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const key = new URL(url).pathname;
    if (init.method === "PUT") {
      if (new Headers(init.headers).get("If-None-Match") === "*" && objects.has(key))
        return new Response(null, { status: 412 });
      objects.set(key, String(init.body));
      return new Response(null);
    }
    if (init.method === "DELETE") {
      objects.delete(key);
      return new Response(null);
    }
    return objects.has(key) ? new Response(objects.get(key)) : new Response(null, { status: 404 });
  });
  vi.mocked(execa).mockImplementation((async (_command: string, args: string[]) => ({
    stdout: args.includes("show")
      ? JSON.stringify({ resource_changes: [] })
      : args.includes("output")
        ? "{}"
        : "",
  })) as typeof execa);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ result: [] }))),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(execa).mockReset();
  mocks.s3.mockReset();
  await rm(directory, { recursive: true, force: true });
});
describe("generated independent OpenTofu infrastructure", () => {
  it("does nothing without infrastructure and gives shared resources one owner", async () => {
    const parsed = parseNordixYaml(createStarterConfiguration("demo", true));
    if (!parsed.success) throw Error("fixture");
    let resolved = resolveProjectYaml(stringifyNordixYaml(parsed.config));
    if (!resolved.success) throw Error("fixture");
    expect(infrastructureManifest(resolved.project, "app")).toBeUndefined();
    expect(await infrastructureFiles(resolved.project, "app")).toEqual({});
    await infrastructureStage({ ...manifest, infrastructure: undefined }, "staging");
    parsed.config.iac = {
      repository: "app",
      cloudflare: {
        r2_storage: { docs: { visibility: "private" }, assets: { visibility: "public" } },
      },
    };
    parsed.config.backends[0].iac = { r2_storage: ["docs", "assets"] };
    resolved = resolveProjectYaml(stringifyNordixYaml(parsed.config));
    if (!resolved.success) throw Error("fixture");
    const files = await infrastructureFiles(resolved.project, "app");
    expect(files["infra/terraform/r2.tf"]).toContain('resource "cloudflare_r2_bucket" "docs"');
    expect(files["infra/terraform/r2.tf"]).toContain(
      'resource "cloudflare_r2_custom_domain" "assets"',
    );
    expect(files["infra/terraform/outputs.tf"]).toContain("cloudflare_r2_bucket.docs.name");
    expect(files["infra/terraform/r2.tf"]).toContain('resource "cloudflare_r2_bucket_cors" "docs"');
    expect(files["infra/terraform/r2.tf"]).toContain('headers = ["content-type", "if-none-match"]');
    const consumer = await infrastructureFiles(resolved.project, "other");
    expect(Object.keys(consumer)).toEqual(["scripts/infra.mjs"]);
  });
  it("uses independent environment state keys and rejects invalid destinations", () => {
    expect(stateKey(manifest, "staging")).toBe("demo/staging");
    expect(stateKey(manifest, "production")).toBe("demo/production");
    expect(() => stateKey({ ...manifest, infrastructure: undefined }, "staging")).toThrow(
      "no infrastructure",
    );
    expect(() => stateKey(manifest, "wrong" as "staging")).toThrow("staging or production");
  });
  it("applies once per commit, shares outputs between builds and never stores application secrets in the marker", async () => {
    const runner = new InfrastructureRunner(manifest, "staging");
    await runner.apply();
    const applied = vi
      .mocked(execa)
      .mock.calls.filter((call) => (call[1] as string[]).includes("apply"));
    expect(applied).toHaveLength(1);
    await runner.apply();
    expect(
      vi.mocked(execa).mock.calls.filter((call) => (call[1] as string[]).includes("apply")),
    ).toHaveLength(1);
    const marker = objects.get("/demo-state/demo/staging/applied.json");
    expect(marker).toContain('"commit":"commit"');
    expect(marker).not.toContain("state-secret");
    expect(objects.has("/demo-state/demo/staging/apply.lock")).toBe(false);
  });
  it("releases the coordination lock when OpenTofu fails and withholds subprocess secrets", async () => {
    vi.mocked(execa).mockRejectedValue(Error("private-provider-token"));
    await expect(new InfrastructureRunner(manifest, "staging").apply()).rejects.toThrow(
      "OpenTofu init failed",
    );
    expect(objects.has("/demo-state/demo/staging/apply.lock")).toBe(false);
  });
  it("refuses an old queued commit before running OpenTofu", async () => {
    vi.stubEnv("WORKERS_CI_BRANCH", "develop");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ commit: { sha: "newer" } })),
    );
    await expect(new InfrastructureRunner(manifest, "staging").apply()).rejects.toThrow(
      "superseded",
    );
    expect(execa).not.toHaveBeenCalled();
  });
  it("never removes the state bucket even if a malformed destructive plan targets it", async () => {
    const runner = new InfrastructureRunner(manifest, "staging");
    await expect(
      runner.emptyDeletedBuckets({
        resource_changes: [
          {
            address: "bucket",
            type: "cloudflare_r2_bucket",
            change: { actions: ["delete"], before: { account_id: "account", name: "demo-state" } },
          },
        ],
      }),
    ).rejects.toThrow("Refusing");
    expect(mocks.s3).not.toHaveBeenCalled();
  });
  it("checks bucket contents without reading objects and only empties buckets from a saved deletion plan", async () => {
    const runner = new InfrastructureRunner(manifest, "staging");
    mocks.s3.mockResolvedValueOnce(
      new Response("<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>"),
    );
    expect(await runner.bucketStatus("empty")).toBe("empty");
    mocks.s3.mockResolvedValueOnce(
      new Response(
        "<ListBucketResult><Contents><Key>private-name.txt</Key></Contents></ListBucketResult>",
      ),
    );
    expect(await runner.bucketStatus("full")).toBe("contains files");
    mocks.s3.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await runner.bucketStatus("unknown")).toBe("not verified");
    mocks.s3
      .mockResolvedValueOnce(
        new Response(
          "<ListBucketResult><Contents><Key>a &amp; b.txt</Key></Contents></ListBucketResult>",
        ),
      )
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(new Response("<ListBucketResult/>"));
    await runner.emptyDeletedBuckets({
      resource_changes: [
        {
          address: "docs",
          type: "cloudflare_r2_bucket",
          change: { actions: ["delete"], before: { account_id: "account", name: "demo-docs" } },
        },
      ],
    });
    expect(
      mocks.s3.mock.calls.some(
        ([url, init]) => url.includes("a%20%26%20b.txt") && init.method === "DELETE",
      ),
    ).toBe(true);
  });
  it("does not claim a split consumer owns the shared infrastructure", async () => {
    const consumer = { ...manifest, infrastructure: { ...manifest.infrastructure, owner: false } };
    await expect(infrastructureStage(consumer, "staging")).rejects.toThrow("owning repository");
    objects.set("/demo-state/demo/staging/applied.json", JSON.stringify({ outputs: {} }));
    await expect(infrastructureStage(consumer, "staging")).resolves.toBeUndefined();
    expect(execa).not.toHaveBeenCalled();
  });
  it("updates only the selected environment bindings and leaves frontend configuration untouched", async () => {
    const backend = join(directory, "api");
    await mkdir(backend);
    await writeFile(
      join(backend, "wrangler.jsonc"),
      JSON.stringify({
        env: { production: { r2_buckets: [{ binding: "OLD", bucket_name: "prod" }] } },
      }),
    );
    manifest.applications = [
      {
        name: "api",
        path: backend,
        worker: "demo-api",
        kind: "backend",
        database: false,
        identity: false,
        connections: [],
        runtimeKeys: [],
      },
    ];
    await new InfrastructureRunner(manifest, "staging").syncBindings({
      api: { docs: { binding: "DOCS", bucket: "stage-docs", public_url: null } },
    });
    const result = JSON.parse(await readFile(join(backend, "wrangler.jsonc"), "utf8"));
    expect(result.env.production.r2_buckets[0].bucket_name).toBe("prod");
    expect(result.env.staging.r2_buckets[0].bucket_name).toBe("stage-docs");
    expect(result.env.staging.vars.R2_SECRET_ACCESS_KEY).toBeUndefined();
  });
  it("reuses the setup key for plans and applies instead of creating extra admin/review tokens", async () => {
    if (!manifest.infrastructure) throw Error("fixture");
    manifest.infrastructure.backends = { api: { worker: "demo-api", storage: ["docs"] } };
    manifest.publicFrontends = {
      web: { worker: "demo-web", connections: ["api"] },
      other: { worker: "demo-other", connections: [] },
    };
    const profile = {
      accountId: "account",
      repository: "owner/repo",
      buildTokenId: "build",
      neonProjects: {},
      urls: {
        staging: { web: "https://stage.example", other: "https://unrelated.example" },
        production: { web: "https://app.example" },
      },
    };
    const api = vi.fn(async (path: string) =>
      path.endsWith("/buckets")
        ? { result: { buckets: [{ name: "demo-state" }] } }
        : { result: { id: "existing-id", status: "active" } },
    );
    vi.mocked(execa).mockResolvedValue({ stdout: "github-key" } as never);
    vi.spyOn(InfrastructureRunner.prototype, "apply").mockResolvedValue();
    const result = await prepareInfrastructure(
      manifest,
      profile,
      "existing-setup-key",
      api,
      vi.fn(),
      vi.fn(),
    );
    expect(result?.build.CLOUDFLARE_API_TOKEN).toBe("existing-setup-key");
    expect(result?.review).toEqual(result?.build);
    expect(result?.eventsToken).toBe("existing-setup-key");
    expect(JSON.parse(result?.build.R2_UPLOAD_ORIGINS ?? "{}")).toEqual({
      staging: { docs: ["https://stage.example"] },
      production: { docs: ["https://app.example"] },
    });
    expect(api.mock.calls.some(([path]) => path.endsWith("/tokens"))).toBe(false);
    expect(
      await prepareInfrastructure(
        { ...manifest, infrastructure: undefined },
        profile,
        "key",
        api,
        vi.fn(),
        vi.fn(),
      ),
    ).toBeUndefined();
  });
  it("accepts only signed same-repository PR events and starts a build without exposing credentials", async () => {
    const worker = new Function(reviewWebhookSource.replace("export default", "return"))() as {
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const env = {
      WEBHOOK_SECRET: "hook-secret",
      BUILDS_TOKEN: "build-secret",
      REPOSITORY: "owner/repo",
      ACCOUNT_ID: "account",
      TRIGGER_ID: "trigger",
    };
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        head: { ref: "feature", sha: "commit", repo: { full_name: "owner/repo" } },
        base: { ref: "develop", repo: { full_name: "owner/repo" } },
      },
    });
    const signature = `sha256=${createHmac("sha256", env.WEBHOOK_SECRET).update(body).digest("hex")}`;
    const build = vi.fn(async () => new Response(null));
    vi.stubGlobal("fetch", build);
    expect(
      (await worker.fetch(new Request("https://events.example", { method: "POST", body }), env))
        .status,
    ).toBe(401);
    expect(build).not.toHaveBeenCalled();
    const response = await worker.fetch(
      new Request("https://events.example", {
        method: "POST",
        body,
        headers: { "x-hub-signature-256": signature, "x-github-event": "pull_request" },
      }),
      env,
    );
    expect(response.status).toBe(202);
    expect(await response.text()).not.toContain("secret");
    expect(JSON.parse(build.mock.calls[0][1].body)).toEqual({
      branch: "feature",
      commit_hash: "commit",
    });
  });
});
