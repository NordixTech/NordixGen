import { confirm, password, select } from "@clack/prompts";
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
  chooseNeonProject,
  connectRepository,
  ensureNeonBranches,
  executeStage,
  provisionNeonProjects,
  publicOrigin,
  redact,
  registerDeploymentToken,
  requestApi,
  validateTopology,
  validatedCredential,
} from "./cicd-assistant.js";
import { deploymentManifest } from "./deployment.js";
import { createStarterConfiguration } from "./orchestrator.js";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("@clack/prompts", async (original) => ({
  ...(await original<typeof import("@clack/prompts")>()),
  confirm: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(execa).mockReset();
  vi.mocked(confirm).mockReset();
  vi.mocked(password).mockReset();
  vi.mocked(select).mockReset();
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
  it("selects a real Neon ID from named projects and validates it before applying", async () => {
    vi.mocked(select)
      .mockResolvedValueOnce("existing")
      .mockResolvedValueOnce("org-demo")
      .mockResolvedValueOnce("red-breeze-123");
    const project = { id: "red-breeze-123", name: "my-friendly-project" };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ organizations: [{ id: "org-demo", name: "Personal" }] })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [project] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ project })));
    vi.stubGlobal("fetch", fetcher);
    await expect(chooseNeonProject("api", "key")).resolves.toBe("red-breeze-123");
    expect(vi.mocked(select).mock.calls[2][0].options[0]).toEqual({
      value: "red-breeze-123",
      label: "my-friendly-project",
      hint: "ID: red-breeze-123",
    });
    expect(fetcher.mock.calls[2][0]).toContain("/projects/red-breeze-123");
    expect(fetcher.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
  });
  it("does not offer a stale saved Neon ID and prepares a new project without creating resources", async () => {
    vi.mocked(select)
      .mockResolvedValueOnce("new")
      .mockResolvedValueOnce("org-demo")
      .mockResolvedValueOnce("aws-us-east-1");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ organizations: [{ id: "org-demo", name: "Personal" }] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ regions: [{ region_id: "aws-us-east-1", name: "US East" }] }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(chooseNeonProject("api", "key", "typed-friendly-name")).resolves.toBe(
      "new:org-demo:aws-us-east-1",
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(vi.mocked(select).mock.calls[0][0].options[0].value).toBe("new");
    expect(fetcher.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
  });
  it("registers the supplied user token for builds without creating a second API token", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { id: "cf-id", status: "active" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { build_token_uuid: "build-id" } })),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      registerDeploymentToken("account", "supplied-token", "demo deployments"),
    ).resolves.toBe("build-id");
    expect(fetcher.mock.calls.map((call) => call[1].method)).toEqual(["GET", "GET", "POST"]);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      build_token_name: "demo deployments",
      build_token_secret: "supplied-token",
      cloudflare_token_id: "cf-id",
    });
    expect(fetcher.mock.calls[2][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/builds/tokens",
    );
  });
  it("reuses a registration for the same token on repeated setup", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { id: "cf-id", status: "active" } })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: [{ cloudflare_token_id: "cf-id", build_token_uuid: "existing" }],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(registerDeploymentToken("account", "supplied-token", "demo")).resolves.toBe(
      "existing",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not register an inactive token", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { id: "cf-id", status: "expired" } })),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(registerDeploymentToken("account", "expired-token", "demo")).rejects.toThrow(
      "not active",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not silently reuse a shell credential and retries a revoked credential without mutations", async () => {
    vi.stubEnv("NEON_API_KEY", "old-key");
    vi.mocked(confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.mocked(password).mockResolvedValueOnce("revoked-key").mockResolvedValueOnce("new-key");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ organizations: [] })));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await validatedCredential(
      "NEON_API_KEY",
      "Create a key in the Console",
      "https://console.neon.tech/api/v2",
      "/users/me/organizations",
    );
    expect(result.token).toBe("new-key");
    expect(fetcher.mock.calls.map((call) => call[1].method)).toEqual(["GET", "GET"]);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer revoked-key");
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer new-key");
  });
  it("explains browser authorization when Cloudflare cannot connect the repository", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: JSON.stringify({ id: 1, name: "demo", owner: { id: 2, login: "owner" } }),
    } as never);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      connectRepository({ accountId: "account", repository: "owner/demo" } as never, "token"),
    ).rejects.toThrow("https://github.com/settings/installations");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/builds/repos/connections");
  });
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
