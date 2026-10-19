import {
  generateBackend,
  generateFrontend,
  parseNordixYaml,
  resolveProjectYaml,
  stringifyNordixYaml,
} from "@nordixgen/core";
import { execa } from "execa";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkDeploymentBranch,
  ensureNeonBranches,
  executeStage,
  provisionNeonProjects,
  publicOrigin,
  redact,
  requestApi,
  validateTopology,
} from "./cicd-assistant.js";
import { deploymentManifest } from "./deployment.js";
import { createStarterConfiguration } from "./orchestrator.js";

vi.mock("execa", () => ({ execa: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(execa).mockReset();
});
function fixture(split = false) {
  const parsed = parseNordixYaml(createStarterConfiguration("cloud-demo", true));
  if (!parsed.success) throw Error("Invalid fixture");
  if (split) {
    parsed.config.repositories[0].path = "backend";
    parsed.config.repositories.push({ ...parsed.config.repositories[0], name: "web", path: "web" });
    parsed.config.frontends[0].repository = "web";
  }
  const result = resolveProjectYaml(stringifyNordixYaml(parsed.config));
  if (!result.success) throw Error("Invalid project");
  return result.project;
}
describe("native deployment safety and contracts", () => {
  it("generates distinct environment Workers and OpenNext output for a monorepo", () => {
    const project = fixture();
    for (const [name, result] of [
      ["api", generateBackend(project, "api")],
      ["web", generateFrontend(project, "web")],
    ] as const) {
      if (!result.success) throw Error("Generation failed");
      const source = result.virtualFileSystem.readFile(`apps/${name}/wrangler.jsonc`);
      const config = JSON.parse(source ?? "{}");
      expect(config.env.staging.name).toBe(`cloud-demo-${name}-staging`);
      expect(config.env.production.name).toBe(`cloud-demo-${name}-production`);
      expect(config).not.toHaveProperty("account_id");
      if (name === "web") {
        expect(config.main).toBe(".open-next/worker.js");
        expect(config.env.production.services[0].service).toBe(config.env.production.name);
      }
    }
  });
  it("keeps split manifests scoped while retaining frontend backend references", () => {
    const project = fixture(true);
    const manifests = project.repositories.map((r) => deploymentManifest(project, r));
    expect(manifests[0].applications.map((a) => a.name)).toEqual(["api"]);
    expect(manifests[1].applications.map((a) => a.name)).toEqual(["web"]);
    expect(manifests[1].applications[0].connections).toEqual(["api"]);
  });
  it("rejects cookie-incompatible identity origins before provisioning", () => {
    const project = fixture();
    const manifest = deploymentManifest(project, project.repositories[0]);
    manifest.applications[1].identityBackend = "api";
    const profile = {
      accountId: "account",
      repository: "owner/repo",
      buildTokenId: "token-id",
      neonProjects: { api: "project" },
      urls: {
        staging: { api: "https://api.example.test", web: "https://web.example.test" },
        production: { api: "https://app.example.test", web: "https://app.example.test" },
      },
    };
    expect(() => validateTopology(manifest, profile)).toThrow("share an origin");
    profile.urls.staging.api = profile.urls.staging.web;
    expect(() => validateTopology(manifest, profile)).not.toThrow();
  });
  it("blocks cross-environment and feature-branch deployment before any command", async () => {
    expect(() => checkDeploymentBranch("production", "develop")).toThrow("Refusing");
    expect(() => checkDeploymentBranch("staging", "feature/a")).toThrow("Refusing");
    expect(() => checkDeploymentBranch("staging", "develop")).not.toThrow();
    vi.stubEnv("WORKERS_CI_BRANCH", "develop");
    const project = fixture();
    await expect(
      executeStage(
        deploymentManifest(project, project.repositories[0]),
        "deploy",
        "api",
        "production",
      ),
    ).rejects.toThrow("Refusing");
    expect(execa).not.toHaveBeenCalled();
  });
  it("runs boundaries and migrations in order and stops when migration fails", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:private@host/db");
    vi.stubEnv("WORKERS_CI_BRANCH", "develop");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(execa).mockImplementation(((_file: string, args: string[]) =>
      args.includes("db:migrate")
        ? Promise.reject(Error("migration failed"))
        : Promise.resolve({ stdout: "" })) as typeof execa);
    const project = fixture();
    await expect(
      executeStage(deploymentManifest(project, project.repositories[0]), "build", "api", "staging"),
    ).rejects.toThrow("Command failed");
    expect(vi.mocked(execa).mock.calls.map((c) => c[1])).toEqual([
      ["--dir", "apps/api", "run", "typecheck"],
      ["--dir", "apps/api", "run", "check:boundaries"],
      ["--dir", "apps/api", "run", "db:migrate"],
    ]);
  });
  it("never resets or recreates existing staging and rejects a mismatched parent", async () => {
    const api = vi.fn().mockResolvedValue({
      branches: [
        { id: "root", name: "main" },
        { id: "stage", name: "staging", parent_id: "root" },
      ],
    });
    expect(await ensureNeonBranches("project", api)).toEqual({
      production: "root",
      staging: "stage",
    });
    expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValue({
      branches: [
        { id: "root", name: "main" },
        { id: "stage", name: "staging", parent_id: "other" },
      ],
    });
    await expect(ensureNeonBranches("project", api)).rejects.toThrow("directly from main");
    expect(api.mock.calls.every((c) => c[1] === undefined)).toBe(true);
  });
  it("creates only the missing staging child with separate compute", async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ branches: [{ id: "root", name: "main" }] })
      .mockResolvedValueOnce({ branch: { id: "stage" } });
    await expect(ensureNeonBranches("project", api)).resolves.toEqual({
      production: "root",
      staging: "stage",
    });
    expect(api).toHaveBeenLastCalledWith(
      "/projects/project/branches",
      "POST",
      expect.objectContaining({
        branch: { name: "staging", parent_id: "root" },
        endpoints: [expect.objectContaining({ type: "read_write", suspend_timeout_seconds: 0 })],
      }),
    );
  });
  it("saves a created Neon project ID and reuses it on retry", async () => {
    const project = fixture();
    const manifest = deploymentManifest(project, project.repositories[0]);
    const profile = {
      accountId: "account",
      repository: "owner/repo",
      buildTokenId: "token-id",
      neonProjects: { api: "new:org-test:aws-us-east-1" },
      urls: { staging: {}, production: {} },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ project: { id: "new-project" } }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const save = vi.fn().mockResolvedValue(undefined);
    await provisionNeonProjects(manifest, profile, "test-api-key", save);
    expect(profile.neonProjects.api).toBe("new-project");
    expect(save).toHaveBeenCalledOnce();
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.project).toMatchObject({
      org_id: "org-test",
      region_id: "aws-us-east-1",
      branch: { name: "main" },
    });
    await provisionNeonProjects(manifest, profile, "test-api-key", save);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("omits provider error bodies and redacts database connections and inherited secrets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("private-provider-value", { status: 403 }));
    await expect(
      requestApi(
        "https://api.example.test",
        "/resource",
        "private-token",
        "GET",
        undefined,
        fetcher,
      ),
    ).rejects.toThrow("HTTP 403");
    try {
      await requestApi(
        "https://api.example.test",
        "/resource",
        "private-token",
        "GET",
        undefined,
        fetcher,
      );
    } catch (e) {
      expect(String(e)).not.toContain("private-provider-value");
    }
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "secret-value-for-tests");
    expect(redact("secret-value-for-tests postgresql://user:password@host/db")).not.toMatch(
      /secret-value|password/,
    );
    for (const origin of [
      "http://test.example",
      "https://u:p@test.example",
      "https://test.example/path",
    ])
      expect(() => publicOrigin(origin)).toThrow();
    expect(publicOrigin("https://app.example/")).toBe("https://app.example");
  });
});
