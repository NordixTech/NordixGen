import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  WORKSPACE_TOOLING,
  parseNordixYaml,
  resolveProjectYaml,
  stringifyNordixYaml,
} from "@nordixgen/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureCommand } from "../tests/scaffold-fixture.js";
import { createStarterConfiguration, runGenerate } from "./orchestrator.js";
import { runCommand, safeFailure } from "./process.js";
import { remoteMatches } from "./repositories.js";
const directories: string[] = [];
async function setup(frontend = false) {
  const directory = await mkdtemp(join(tmpdir(), "nordixgen-cli-"));
  directories.push(directory);
  const file = join(directory, "source.yaml");
  const output = join(directory, "out");
  const parsed = parseNordixYaml(createStarterConfiguration("working-app", frontend));
  if (!parsed.success) throw Error("Invalid starter");
  return { directory, file, output, config: parsed.config };
}
async function save(f: Awaited<ReturnType<typeof setup>>) {
  await writeFile(f.file, stringifyNordixYaml(f.config));
}
function publication(f: Awaited<ReturnType<typeof setup>>) {
  vi.stubEnv("GH_HOST", "github.com");
  f.config.organizations = [{ name: "internal", handle: "ActualOrg" }];
  Object.assign(f.config.repositories[0], {
    initializeGit: true,
    createRemote: true,
    organization: "internal",
    visibility: "public",
  });
}
async function readyCommand(file: string, args: string[], cwd: string): Promise<string> {
  if (file === "git" && args[0] === "config" && args[1] === "--get")
    return args[2] === "user.name" ? "Verifier" : "verifier@example.test";
  if (file === "gh" && args[0] === "repo" && args[1] === "view") throw Error("HTTP 404: Not Found");
  if (file === "git" && args[0] === "remote") return "git@github.com:ActualOrg/app.git";
  if (file === "git" && args[0] === "symbolic-ref") return "main";
  return fixtureCommand(file, args, cwd);
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}nordixgen-cli-`))
      throw Error("Unsafe CLI fixture cleanup");
    await rm(directory, { recursive: true, force: true });
  }
});
describe("fixed-stack CLI preparation and execution", () => {
  it("reports compiler stdout together with stderr warnings", async () => {
    await expect(
      runCommand(
        process.execPath,
        [
          "-e",
          "console.error('framework warning');console.log('source.ts: actual type failure');process.exitCode=1",
        ],
        process.cwd(),
      ),
    ).rejects.toThrow(/framework warning[\s\S]*source.ts: actual type failure/);
  });
  it.each([false, true])(
    "initializes a generation-ready useful project with frontend %s",
    (frontend) => {
      const result = resolveProjectYaml(
        createStarterConfiguration("working-app", frontend),
        undefined,
        { requireGeneration: true },
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.project.backends.api.database?.engine).toBe("postgres");
      expect(
        Object.values(result.project.operations)
          .map((operation) => operation.operationId)
          .sort(),
      ).toEqual(["createExample", "listExamples"]);
    },
  );
  it("rejects an existing destination or a file before calling any process", async () => {
    const f = await setup();
    await save(f);
    await mkdir(f.output);
    await writeFile(join(f.output, "keep.txt"), "user data");
    const runner = vi.fn(readyCommand);
    await expect(runGenerate(f.file, f.output, runner)).rejects.toThrow("new or empty");
    expect(runner).not.toHaveBeenCalled();
    expect(await readFile(join(f.output, "keep.txt"), "utf8")).toBe("user data");
    const target = join(f.directory, "file");
    await writeFile(target, "keep");
    await expect(runGenerate(f.file, target, runner)).rejects.toThrow("not a file");
    expect(runner).not.toHaveBeenCalled();
  });
  it("rejects a linked destination before scaffolding or repository effects", async () => {
    const f = await setup();
    await save(f);
    const real = join(f.directory, "real");
    await mkdir(real);
    await symlink(real, f.output, process.platform === "win32" ? "junction" : "dir");
    const runner = vi.fn(readyCommand);
    await expect(runGenerate(f.file, f.output, runner)).rejects.toThrow("symbolic links");
    expect(runner).not.toHaveBeenCalled();
    expect(await readdir(real)).toEqual([]);
  });
  it("rejects unavailable tooling, missing Git identity and an existing remote before output creation", async () => {
    for (const failure of ["pnpm", "identity", "remote"]) {
      const f = await setup();
      if (failure === "identity") f.config.repositories[0].initializeGit = true;
      if (failure === "remote") publication(f);
      await save(f);
      const runner = vi.fn(async (file: string, args: string[], cwd: string) => {
        if (failure === "pnpm" && file === "pnpm") throw Error("not found");
        if (failure === "identity" && file === "git" && args[0] === "config") return "";
        if (failure === "remote" && file === "gh" && args[1] === "view")
          return '{"nameWithOwner":"ActualOrg/app"}';
        return readyCommand(file, args, cwd);
      });
      await expect(runGenerate(f.file, f.output, runner)).rejects.toThrow(
        failure === "remote"
          ? "already exists"
          : failure === "identity"
            ? "nonempty Git"
            : "Package manager preflight",
      );
      await expect(readdir(f.output)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        runner.mock.calls.some(
          (call) => call[1][0] === "init" || call[1][0] === "create" || call[1][0] === "dlx",
        ),
      ).toBe(false);
    }
  });
  it("rejects remote publication without local Git through the shared located validation path", async () => {
    const f = await setup();
    publication(f);
    f.config.repositories[0].initializeGit = false;
    await writeFile(f.file, JSON.stringify(f.config));
    const runner = vi.fn(readyCommand);
    await expect(runGenerate(f.file, f.output, runner)).rejects.toThrow(
      /REMOTE_REQUIRES_LOCAL_GIT.*source.yaml/,
    );
    expect(runner).not.toHaveBeenCalled();
  });
  it("emits independent split workspaces and installs only after all application preparation", async () => {
    const f = await setup(true);
    f.config.repositories = [
      {
        name: "backend",
        path: "backend",
        initializeGit: false,
        createRemote: false,
        visibility: "private",
      },
      {
        name: "frontend",
        path: "frontend",
        initializeGit: false,
        createRemote: false,
        visibility: "private",
      },
    ];
    f.config.backends[0].repository = "backend";
    f.config.frontends[0].repository = "frontend";
    await save(f);
    const runner = vi.fn(async (file: string, args: string[], cwd: string) => {
      await fixtureCommand(file, args, cwd);
      if (args[1]?.startsWith("hono@") || args[1]?.startsWith("create-next-app@")) {
        expect(args[2]).toBe("app");
        expect(await readFile(join(cwd, "pnpm-workspace.yaml"), "utf8")).toContain('"app"');
        await mkdir(join(cwd, "app", "node_modules"));
        await writeFile(join(cwd, "app", "node_modules", "discard"), "not copied");
      }
      return "";
    });
    await runGenerate(f.file, f.output, runner);
    const installs = runner.mock.calls.filter((call) => call[1][0] === "install");
    expect(installs.map((call) => call[2]).sort()).toEqual(
      [join(f.output, "backend"), join(f.output, "frontend")].sort(),
    );
    const lastScaffold = Math.max(
      ...runner.mock.calls.map((call, index) =>
        call[1][0] === "create" || call[1][0] === "dlx" ? index : -1,
      ),
    );
    const firstInstall = runner.mock.calls.findIndex((call) => call[1][0] === "install");
    expect(lastScaffold).toBeLessThan(firstInstall);
    const backend = join(f.output, "backend", "apps/api");
    const manifest = JSON.parse(await readFile(join(backend, "package.json"), "utf8"));
    expect(manifest.dependencies).toHaveProperty("drizzle-orm");
    expect(manifest.devDependencies).toHaveProperty("drizzle-kit");
    expect(manifest.scripts["db:migrate"]).toContain("src/platform/database");
    await expect(readdir(join(backend, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(f.output, "backend", "pnpm-workspace.yaml"), "utf8")).toContain(
      '"apps/api"',
    );
    expect(await readFile(join(f.output, "frontend", "pnpm-workspace.yaml"), "utf8")).toContain(
      '"apps/web"',
    );
    expect((await readdir(f.output)).some((name) => name.startsWith(".nordixgen-scaffold-"))).toBe(
      false,
    );
  });
  it("supports an application at its repository root without replacing its application scripts", async () => {
    const f = await setup();
    f.config.backends[0].path = ".";
    await save(f);
    await runGenerate(f.file, f.output, vi.fn(readyCommand));
    const manifest = JSON.parse(await readFile(join(f.output, "package.json"), "utf8"));
    expect(manifest.name).toBe("api");
    expect(manifest.scripts.dev).toBe("wrangler dev");
    expect(manifest.packageManager).toBe(WORKSPACE_TOOLING.packageManager);
    expect(await readFile(join(f.output, "pnpm-workspace.yaml"), "utf8")).toContain('"."');
    expect(await readFile(join(f.output, "src/index.ts"), "utf8")).toContain("new Hono");
  });
  it.each(["scaffold", "install", "typecheck", "boundaries"])(
    "contains %s failures and never initializes or publishes repositories afterward",
    async (stage) => {
      const f = await setup(true);
      publication(f);
      await save(f);
      const secret = "postgresql://reader:private-password@localhost/test token=my-test-token";
      const runner = vi.fn(async (file: string, args: string[], cwd: string) => {
        if (
          (stage === "scaffold" && args[1]?.startsWith("hono@")) ||
          (stage === "install" && args[0] === "install") ||
          (stage === "typecheck" && args.join(" ") === "run typecheck") ||
          (stage === "boundaries" && args.join(" ") === "run check:boundaries")
        )
          throw Error(secret);
        return readyCommand(file, args, cwd);
      });
      let failure = "";
      try {
        await runGenerate(f.file, f.output, runner);
      } catch (error) {
        failure = (error as Error).message;
      }
      expect(failure).toMatch(/application|Application|dependency installation/);
      expect(failure).not.toContain("private-password");
      expect(failure).not.toContain("my-test-token");
      expect(failure).toContain("[redacted]");
      expect(
        runner.mock.calls.some(
          (call) =>
            (call[0] === "git" && call[1][0] === "init") ||
            (call[0] === "gh" && call[1][0] === "repo" && call[1][1] === "create"),
        ),
      ).toBe(false);
    },
  );
  it("rejects incomplete upstream output and unexpected script/file collisions before final installs", async () => {
    for (const kind of ["missing", "script", "file"]) {
      const f = await setup();
      await save(f);
      const runner = vi.fn(async (file: string, args: string[], cwd: string) => {
        if (kind !== "missing") await fixtureCommand(file, args, cwd);
        if (args[1]?.startsWith("hono@")) {
          if (kind === "script") {
            const manifest = JSON.parse(await readFile(join(cwd, "app/package.json"), "utf8"));
            manifest.scripts.typecheck = "unexpected command";
            await writeFile(join(cwd, "app/package.json"), JSON.stringify(manifest));
          }
          if (kind === "file") {
            const path = join(cwd, "app/src/platform/application");
            await mkdir(path, { recursive: true });
            await writeFile(join(path, "contracts.ts"), "unexpected upstream source");
          }
        }
        return "";
      });
      await expect(runGenerate(f.file, f.output, runner)).rejects.toThrow(
        kind === "missing"
          ? "did not produce"
          : kind === "script"
            ? "script collision"
            : "file collision",
      );
      expect(runner.mock.calls.some((call) => call[1][0] === "install")).toBe(false);
      expect(
        (await readdir(f.output)).some((name) => name.startsWith(".nordixgen-scaffold-")),
      ).toBe(false);
    }
  });
  it("uses the organization handle, configured visibility and verified push preflight", async () => {
    const f = await setup();
    publication(f);
    await save(f);
    const runner = vi.fn(readyCommand);
    await runGenerate(f.file, f.output, runner);
    const create = runner.mock.calls.find((call) => call[0] === "gh" && call[1][1] === "create");
    expect(create?.[1]).toContain("ActualOrg/app");
    expect(create?.[1]).toContain("--public");
    expect(create?.[1]).not.toContain("--push");
    const dry = runner.mock.calls.findIndex((call) => call[1].includes("--dry-run"));
    const push = runner.mock.calls.findIndex((call) => call[1].includes("--set-upstream"));
    expect(dry).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(dry);
    expect(runner.mock.calls[push][1]).toContain("HEAD:refs/heads/main");
  });
  it("refuses mismatched origins and failed dry-run pushes", async () => {
    for (const wrongOrigin of [true, false]) {
      const f = await setup();
      publication(f);
      await save(f);
      const runner = vi.fn(async (file: string, args: string[], cwd: string) => {
        if (wrongOrigin && file === "git" && args[0] === "remote")
          return "https://github.com/OtherOrg/other.git";
        if (!wrongOrigin && args.includes("--dry-run")) throw Error("push permission denied");
        return readyCommand(file, args, cwd);
      });
      await expect(runGenerate(f.file, f.output, runner)).rejects.toThrow(
        wrongOrigin ? "origin does not match" : "push preflight failed",
      );
      expect(runner.mock.calls.some((call) => call[1].includes("--set-upstream"))).toBe(false);
    }
  });
  it("initializes a real local repository while excluding runtime secrets and retaining examples", async () => {
    const f = await setup();
    f.config.repositories[0].initializeGit = true;
    await save(f);
    const runner = vi.fn(async (file: string, args: string[], cwd: string) => {
      if (
        file === "git" &&
        !(args[0] === "config" && args[1] === "--get") &&
        args[0] !== "--version"
      ) {
        const result = await runCommand(file, args, cwd);
        if (args[0] === "init") {
          await writeFile(join(cwd, "apps/api/.dev.vars"), "SECRET=disposable-test-value");
          await writeFile(join(cwd, ".env.local"), "SECRET=disposable-test-value");
        }
        return result;
      }
      return readyCommand(file, args, cwd);
    });
    await runGenerate(f.file, f.output, runner);
    const files = await runCommand("git", ["ls-files"], f.output);
    expect(files).toContain(".dev.vars.example");
    expect(files).not.toMatch(/(^|\n).*\.dev\.vars(\n|$)|(^|\n)\.env\.local(\n|$)/);
    expect(await runCommand("git", ["status", "--porcelain"], f.output)).toBe("");
  }, 20_000);
  it("verifies only the configured GitHub remote and redacts inherited secret values", () => {
    expect(
      remoteMatches("https://github.com/ActualOrg/app.git", "github.com", "ActualOrg/app"),
    ).toBe(true);
    expect(
      remoteMatches("ssh://git@github.com/ActualOrg/app.git", "github.com", "ActualOrg/app"),
    ).toBe(true);
    for (const remote of [
      "https://evil.test/ActualOrg/app.git",
      "https://token@github.com/ActualOrg/app.git",
      "not a remote",
    ])
      expect(remoteMatches(remote, "github.com", "ActualOrg/app")).toBe(false);
    vi.stubEnv("VERIFICATION_API_KEY", "private-long-test-value");
    expect(safeFailure(Error("private-long-test-value"))).toBe("[redacted]");
  });
});
