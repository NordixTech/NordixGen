import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseNordixYaml } from "@nordixgen/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterConfiguration, runGenerate } from "./orchestrator.js";

const temporaryDirectories: string[] = [];
async function makeTempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "nordixgen-cli-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const configuration = `name: test-project
version: 1.0.0
repositories:
  - name: workspace
    path: .
    initializeGit: false
    createRemote: false
frontends:
  - name: web
    framework: nextjs
    repository: workspace
    connectsTo: [api]
    path: apps/web
backends:
  - name: api
    framework: hono
    repository: workspace
    path: apps/api
entities:
  User:
    backend: api
    fields: {}
`;

function withRemote(source: string, initializeGit = false): string {
  return source
    .replace(
      "version: 1.0.0",
      "version: 1.0.0\norganizations:\n  - name: owner\n    provider: github\n    handle: NordixTech",
    )
    .replace("    initializeGit: false", `    initializeGit: ${initializeGit}`)
    .replace("    createRemote: false", "    organization: owner\n    createRemote: true");
}

describe("init command configuration", () => {
  it("creates a valid starter YAML and keeps Git/remote actions opt-in", () => {
    const starter = createStarterConfiguration("my-project", true);
    const parsed = parseNordixYaml(starter);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.config.repositories[0]?.initializeGit).toBe(false);
    expect(parsed.config.repositories[0]?.createRemote).toBe(false);
    expect(parsed.config.frontends[0]?.connectsTo).toEqual(["api"]);
  });
});

describe("generate command orchestration", () => {
  it("scaffolds supported apps and assembles a pnpm workspace", async () => {
    const root = await makeTempDirectory();
    const configPath = join(root, "nordix.config.yaml");
    const output = join(root, "generated");
    await writeFile(configPath, configuration, "utf8");
    const calls: string[][] = [];
    const runner = vi.fn(async (_file: string, args: string[], cwd: string) => {
      calls.push(args);
      const directoryName = args[2];
      if (directoryName && (args.includes("create-next-app@15.1.7") || args[0] === "create")) {
        const appDirectory = resolve(cwd, basename(directoryName));
        await mkdir(appDirectory, { recursive: true });
        await writeFile(join(appDirectory, "package.json"), "{}\n", "utf8");
      }
      return "";
    });

    await runGenerate(configPath, output, runner);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--disable-git");
    expect(calls[0]).toContain("--src-dir");
    expect(await readFile(join(output, "README.md"), "utf8")).toContain("# ✦ NordixGen");
    expect(await readFile(join(output, "README.md"), "utf8")).toContain("test-project");
    const homepage = await readFile(join(output, "apps", "web", "src", "app", "page.tsx"), "utf8");
    expect(homepage).toContain("BUILT WITH NORDIXGEN");
    expect(homepage).toContain("for test-project.");
    expect(calls[1]).toEqual([
      "create",
      "hono@0.19.4",
      "api",
      "--template",
      "cloudflare-workers",
      "--pm",
      "pnpm",
      "--install",
    ]);
    expect(
      await readFile(
        join(output, "apps", "api", "src", "presentation", "controllers", "routes.ts"),
        "utf8",
      ),
    ).toContain('routes.route("/health", healthController);');
    expect(await readFile(join(output, "apps", "api", "src", "index.ts"), "utf8")).toContain(
      'from "./presentation/controllers/routes.js"',
    );
    expect(await readFile(join(output, "pnpm-workspace.yaml"), "utf8")).toContain("apps/web");
    const rootPackage = JSON.parse(await readFile(join(output, "package.json"), "utf8"));
    expect(rootPackage.scripts.dev).toContain("--parallel");
    expect(await readFile(join(output, "README.md"), "utf8")).toContain("workspace");
  });

  it("writes Hono plugin files beneath a repository subdirectory with valid relative imports", async () => {
    const root = await makeTempDirectory();
    const configPath = join(root, "nordix.config.yaml");
    const output = join(root, "generated");
    const nestedConfiguration = configuration
      .replace("path: .\n    initializeGit", "path: repositories/platform\n    initializeGit")
      .replace("framework: nextjs", "framework: nextjs");
    await writeFile(configPath, nestedConfiguration, "utf8");

    const runner = vi.fn(async (_file: string, args: string[], cwd: string) => {
      const directoryName = args[2];
      if (directoryName && (args.includes("create-next-app@15.1.7") || args[0] === "create")) {
        const appDirectory = resolve(cwd, basename(directoryName));
        await mkdir(appDirectory, { recursive: true });
        await writeFile(join(appDirectory, "package.json"), "{}\n", "utf8");
      }
      return "";
    });

    await runGenerate(configPath, output, runner);

    const sourceRoot = join(output, "repositories", "platform", "apps", "api", "src");
    expect(await readFile(join(sourceRoot, "index.ts"), "utf8")).toContain(
      'from "./presentation/controllers/routes.js"',
    );
    expect(
      await readFile(join(sourceRoot, "presentation", "controllers", "routes.ts"), "utf8"),
    ).toContain('from "./health.controller.js"');
  });

  it("refuses a non-empty destination before running any generator", async () => {
    const root = await makeTempDirectory();
    const configPath = join(root, "nordix.config.yaml");
    const output = join(root, "generated");
    await writeFile(configPath, configuration, "utf8");
    await mkdir(output);
    await writeFile(join(output, "keep.txt"), "user data", "utf8");
    const runner = vi.fn();

    await expect(runGenerate(configPath, output, runner)).rejects.toThrow(
      "Target directory must be empty",
    );
    expect(runner).not.toHaveBeenCalled();
    expect(await readFile(join(output, "keep.txt"), "utf8")).toBe("user data");
  });

  it("rejects an unsupported framework before creating output", async () => {
    const root = await makeTempDirectory();
    const configPath = join(root, "nordix.config.yaml");
    const output = join(root, "generated");
    await writeFile(
      configPath,
      configuration.replace("framework: hono", "framework: express"),
      "utf8",
    );

    await expect(runGenerate(configPath, output, vi.fn())).rejects.toThrow(
      "supports Next.js and Hono",
    );
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops before generation if GitHub denies organization repository creation", async () => {
    const root = await makeTempDirectory();
    const configPath = join(root, "nordix.config.yaml");
    const output = join(root, "generated");
    await writeFile(configPath, withRemote(configuration), "utf8");
    const calls: string[][] = [];
    const runner = vi.fn(async (_file: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "api" && args[1] === "user") return "developer";
      if (args[0] === "api" && args[1] === "graphql") {
        return JSON.stringify({
          data: {
            organization: { login: "NordixTech", viewerCanCreateRepositories: false },
            user: null,
          },
        });
      }
      return "authenticated";
    });

    await expect(runGenerate(configPath, output, runner)).rejects.toThrow(
      "cannot create repositories",
    );
    expect(calls.some((args) => args[0] === "repo" && args[1] === "create")).toBe(false);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts a delegated user account for an organization and checks push before sending", async () => {
    const root = await makeTempDirectory();
    const configPath = join(root, "nordix.config.yaml");
    const output = join(root, "generated");
    await writeFile(configPath, withRemote(configuration, true), "utf8");
    const calls: string[][] = [];
    const runner = vi.fn(async (_file: string, args: string[], cwd: string) => {
      calls.push(args);
      if (args[0] === "api" && args[1] === "user") return "developer";
      if (args[0] === "api" && args[1] === "graphql") {
        return JSON.stringify({
          data: {
            organization: { login: "NordixTech", viewerCanCreateRepositories: true },
            user: null,
          },
        });
      }
      if (args[0] === "api" && args[1]?.startsWith("repos/")) {
        throw new Error("gh: Not Found (HTTP 404)");
      }
      if (args[0] === "remote" && args[1] === "get-url") {
        return "https://github.com/NordixTech/workspace.git";
      }
      const directoryName = args[2];
      if (directoryName && (args.includes("create-next-app@15.1.7") || args[0] === "create")) {
        const appDirectory = resolve(cwd, basename(directoryName));
        await mkdir(appDirectory, { recursive: true });
        await writeFile(join(appDirectory, "package.json"), "{}\n", "utf8");
      }
      return "ok";
    });

    await runGenerate(configPath, output, runner);

    const dryRunIndex = calls.findIndex((args) => args[0] === "push" && args.includes("--dry-run"));
    const pushIndex = calls.findIndex((args) => args[0] === "push" && !args.includes("--dry-run"));
    expect(calls.some((args) => args[0] === "repo" && args[1] === "create")).toBe(true);
    expect(dryRunIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(dryRunIndex);
  });

  it("keeps split applications in their assigned repositories", async () => {
    const root = await makeTempDirectory();
    const configPath = join(root, "nordix.config.yaml");
    const output = join(root, "generated");
    const splitConfig = `name: split-test
version: 1.0.0
repositories:
  - name: web-repo
    path: web-repo
    initializeGit: false
    createRemote: false
  - name: api-repo
    path: api-repo
    initializeGit: false
    createRemote: false
frontends:
  - name: web
    framework: nextjs
    repository: web-repo
    connectsTo: [api]
    path: .
backends:
  - name: api
    framework: hono
    repository: api-repo
    path: .
entities:
  User:
    backend: api
    fields: {}
`;
    await writeFile(configPath, splitConfig, "utf8");
    const runner = vi.fn(async (_file: string, args: string[], cwd: string) => {
      const directoryName = args[2];
      if (directoryName && (args.includes("create-next-app@15.1.7") || args[0] === "create")) {
        const appDirectory = resolve(cwd, basename(directoryName));
        await mkdir(appDirectory, { recursive: true });
        await writeFile(join(appDirectory, "package.json"), "{}\n", "utf8");
        await writeFile(join(appDirectory, "README.md"), "upstream app README\n", "utf8");
      }
      return "";
    });

    await runGenerate(configPath, output, runner);

    expect(await readFile(join(output, "web-repo", "README.md"), "utf8")).toContain(
      "# ✦ NordixGen",
    );
    expect(await readFile(join(output, "web-repo", "README.md"), "utf8")).toContain(
      "upstream app README",
    );
    expect(await readFile(join(output, "api-repo", "README.md"), "utf8")).toContain(
      "# ✦ NordixGen",
    );
    expect(await readFile(join(output, "api-repo", "README.md"), "utf8")).toContain(
      "upstream app README",
    );
    await expect(access(join(output, "pnpm-workspace.yaml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
