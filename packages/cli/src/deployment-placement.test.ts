import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { select } from "@clack/prompts";
import { resolveProjectYaml } from "@nordix-tech/nordixgen-core";
import { execa } from "execa";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseDeploymentRegions, configure, executeStage } from "./cicd-assistant.js";
import type { DeploymentManifest, DeploymentProfile } from "./deployment-model.js";
import {
  applyWorkerPlacement,
  cloudflareRegion,
  placementVariable,
  workerPlacement,
} from "./deployment-placement.js";
import { deploymentFiles } from "./deployment.js";
import { createStarterConfiguration } from "./orchestrator.js";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("@clack/prompts", async (original) => ({
  ...(await original<typeof import("@clack/prompts")>()),
  select: vi.fn(),
}));
let directory = "";
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(select).mockReset();
  vi.mocked(execa).mockReset();
  if (directory) {
    if (!directory.startsWith(`${resolve(tmpdir())}${sep}nordix-placement-`))
      throw Error("Unsafe test directory");
    await rm(directory, { recursive: true, force: true });
    directory = "";
  }
});
const regions = [
  { region_id: "aws-us-east-1", name: "US East (Virginia)" },
  { region_id: "gcp-us-central1", name: "Iowa" },
  { region_id: "aws-sa-east-1", name: "São Paulo" },
];
const config = `{
 // Preserve authored configuration and the other environment.
 "name":"api", "main":"src/index.ts", "workers_dev":false,
 "placement":{"mode":"smart"},
 "env":{
  "staging":{"placement":{"region":"aws:us-west-2"},"vars":{"KEEP":"value"}},
  "production":{"placement":{"mode":"smart","host":"old.example:5432"},"r2_buckets":[{"binding":"FILES","bucket_name":"files"}],},
 },
}`;
async function fixture() {
  directory = await mkdtemp(join(tmpdir(), "nordix-placement-"));
  const file = join(directory, "wrangler.jsonc");
  await writeFile(file, config);
  return file;
}
function manifest(): DeploymentManifest {
  return {
    version: 1,
    project: "test",
    repository: "app",
    applications: [
      {
        name: "api",
        path: directory,
        worker: "test-api",
        kind: "backend",
        database: false,
        identity: false,
        connections: [],
        runtimeKeys: [],
      },
    ],
  };
}

describe("explicit backend placement", () => {
  it("ships a runnable standalone project assistant and the region setup guide", async () => {
    await fixture();
    const resolved = resolveProjectYaml(createStarterConfiguration("region-demo", true));
    if (!resolved.success) throw Error("Invalid project");
    const files = await deploymentFiles(resolved.project, resolved.project.repositories[0]);
    expect(files["docs/DEPLOYMENT.md"]).toContain(placementVariable);
    const file = join(directory, "cicd.mjs");
    await writeFile(file, files["scripts/cicd.mjs"]);
    const result = spawnSync(process.execPath, [file, "--help"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 15000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("cicd:setup");
  });
  it("maps Neon cloud regions without accepting hosts, URLs or credentials as placement", () => {
    expect(cloudflareRegion("aws-us-east-1")).toBe("aws:us-east-1");
    expect(cloudflareRegion("gcp-us-central1")).toBe("gcp:us-central1");
    expect(workerPlacement("aws:sa-east-1")).toEqual({ region: "aws:sa-east-1" });
    expect(workerPlacement("smart")).toEqual({ mode: "smart" });
    for (const value of [
      "https://db.example",
      "aws:us-east-1\nsecret",
      "aws:../secret",
      "postgres://user:password@host/db",
      "",
    ]) {
      expect(() => workerPlacement(value)).toThrow("Invalid backend placement");
      expect(cloudflareRegion(value)).toBeUndefined();
    }
  });
  it("lets the user independently select a different backend region before creating a new database", async () => {
    const fetcher = vi.fn(async () => Response.json({ regions }));
    vi.stubGlobal("fetch", fetcher);
    vi.mocked(select).mockResolvedValue("gcp:us-central1");
    expect(await chooseDeploymentRegions("api", "new:org:aws-us-east-1", "token")).toEqual({
      databaseRegion: "aws-us-east-1",
      backendPlacement: "gcp:us-central1",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toMatch(/\/regions$/);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(vi.mocked(select).mock.calls[0][0]).toMatchObject({
      initialValue: "aws:us-east-1",
      options: expect.arrayContaining([
        expect.objectContaining({ value: "aws:us-east-1", hint: "same region as Neon" }),
        expect.objectContaining({ value: "smart" }),
      ]),
    });
  });
  it("reads the current region of an existing database and retains the user's saved selection", async () => {
    const fetcher = vi.fn(async (url: unknown) =>
      Response.json(
        String(url).endsWith("/regions")
          ? { regions }
          : { project: { id: "existing", region_id: "aws-sa-east-1" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.mocked(select).mockResolvedValue("aws:us-east-1");
    expect(await chooseDeploymentRegions("api", "existing", "token", "aws:us-east-1")).toEqual({
      databaseRegion: "aws-sa-east-1",
      backendPlacement: "aws:us-east-1",
    });
    expect(vi.mocked(select).mock.calls[0][0]).toMatchObject({ initialValue: "aws:us-east-1" });
    expect(fetcher.mock.calls.every((call) => call[1]?.method === "GET")).toBe(true);
  });
  it("rejects a mismatched project and unsupported prompt answers before changing anything", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ project: { id: "wrong", region_id: "aws-us-east-1" } })),
    );
    await expect(chooseDeploymentRegions("api", "expected", "token")).rejects.toThrow(
      "unexpected project",
    );
    expect(select).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ regions })),
    );
    vi.mocked(select).mockResolvedValue("aws:unoffered-region");
    await expect(chooseDeploymentRegions("api", "new:org:aws-us-east-1", "token")).rejects.toThrow(
      "offered backend locations",
    );
  });
  it("updates only the selected environment, preserves JSONC comments and removes incompatible hints", async () => {
    const file = await fixture();
    await applyWorkerPlacement(file, "production", "aws:us-east-1");
    const first = await readFile(file, "utf8");
    const parsed = parse(first);
    expect(first).toContain("// Preserve authored configuration");
    expect(parsed.env.production.placement).toEqual({ region: "aws:us-east-1" });
    expect(parsed.env.staging).toEqual(parse(config).env.staging);
    expect(parsed.workers_dev).toBe(false);
    expect(parsed.env.production.r2_buckets).toEqual(parse(config).env.production.r2_buckets);
    await applyWorkerPlacement(file, "production", "aws:us-east-1");
    expect(await readFile(file, "utf8")).toBe(first);
    await applyWorkerPlacement(file, "production", "smart");
    expect(parse(await readFile(file, "utf8")).env.production.placement).toEqual({ mode: "smart" });
  });
  it("keeps old profiles unchanged and fails closed on invalid placement or broken Wrangler JSON", async () => {
    const file = await fixture();
    await applyWorkerPlacement(file, "staging", undefined);
    expect(await readFile(file, "utf8")).toBe(config);
    await expect(applyWorkerPlacement(file, "production", "unsafe")).rejects.toThrow(
      "Invalid backend placement",
    );
    expect(await readFile(file, "utf8")).toBe(config);
    await writeFile(file, '{"env":{');
    await expect(applyWorkerPlacement(file, "production", "smart")).rejects.toThrow(
      "Invalid Wrangler",
    );
  });
  it("restores the CI choice during build and deploy without reading a local profile", async () => {
    const file = await fixture();
    vi.stubEnv(placementVariable, "gcp:us-central1");
    vi.stubEnv("WORKERS_CI_BRANCH", "main");
    vi.mocked(execa).mockResolvedValue({ stdout: "" } as never);
    await executeStage(manifest(), "build", "api", "production");
    expect(parse(await readFile(file, "utf8")).env.production.placement).toEqual({
      region: "gcp:us-central1",
    });
    await writeFile(file, config);
    await executeStage(manifest(), "deploy", "api", "production");
    expect(parse(await readFile(file, "utf8")).env.production.placement).toEqual({
      region: "gcp:us-central1",
    });
    expect(
      vi.mocked(execa).mock.calls.some((call) => (call[1] as string[]).includes("deploy")),
    ).toBe(true);
    vi.stubEnv(placementVariable, "invalid");
    vi.mocked(execa).mockClear();
    await expect(executeStage(manifest(), "deploy", "api", "production")).rejects.toThrow(
      "Invalid backend placement",
    );
    expect(execa).not.toHaveBeenCalled();
  });
  it("registers placement in both Workers Builds triggers rather than as a runtime secret", async () => {
    const file = await fixture();
    const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
    vi.mocked(execa).mockResolvedValue({
      stdout: JSON.stringify({ id: 12, name: "repo", owner: { id: 3, login: "owner" } }),
    } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        calls.push({ path, method, body });
        let result: unknown = {};
        if (path.endsWith("/repos/connections")) result = { repo_connection_uuid: "connection" };
        else if (path.endsWith("/workers/scripts"))
          result = [
            { id: "test-api-staging", tag: "staging-tag" },
            { id: "test-api-production", tag: "production-tag" },
          ];
        else if (path.endsWith("/triggers") && method === "GET") result = [];
        else if (path.endsWith("/triggers")) result = { trigger_uuid: body.trigger_name };
        return Response.json({ success: true, result });
      }),
    );
    const profile: DeploymentProfile = {
      accountId: "account",
      repository: "owner/repo",
      buildTokenId: "build-token",
      neonProjects: {},
      backendPlacements: { api: "aws:sa-east-1" },
      urls: { staging: {}, production: {} },
    };
    await configure(manifest(), profile, "cf-token", "neon-token");
    const builds = calls.filter((call) => call.path.endsWith("/environment_variables"));
    expect(builds).toHaveLength(2);
    for (const call of builds)
      expect(call.body[placementVariable]).toEqual({ value: "aws:sa-east-1", is_secret: false });
    expect(
      calls
        .filter((call) => call.path.endsWith("/secrets"))
        .some((call) => call.body.name === placementVariable),
    ).toBe(false);
    const parsed = parse(await readFile(file, "utf8"));
    expect(parsed.env.staging.placement).toEqual({ region: "aws:sa-east-1" });
    expect(parsed.env.production.placement).toEqual({ region: "aws:sa-east-1" });
  });
  it("leaves frontend placement unchanged when a backend placement variable is present", async () => {
    const file = await fixture();
    const app = manifest();
    app.applications[0].kind = "frontend";
    vi.stubEnv(placementVariable, "aws:us-east-1");
    vi.stubEnv("WORKERS_CI_BRANCH", "main");
    vi.mocked(execa).mockResolvedValue({ stdout: "" } as never);
    await executeStage(app, "deploy", "api", "production");
    expect(await readFile(file, "utf8")).toBe(config);
  });
});
