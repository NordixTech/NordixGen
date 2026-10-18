import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as prompts from "@clack/prompts";
import { parseNordixYaml } from "@nordixgen/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./index.js";
import { createStarterConfiguration, runGenerate, runInit } from "./orchestrator.js";

vi.mock("@clack/prompts", async (original) => ({
  ...(await original<typeof import("@clack/prompts")>()),
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  isCancel: (value: unknown) => typeof value === "symbol",
}));

const directories: string[] = [];
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "nordixgen-config-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    if (
      !resolve(directory).startsWith(`${resolve(tmpdir())}\\nordixgen-config-`) &&
      !resolve(directory).startsWith(`${resolve(tmpdir())}/nordixgen-config-`)
    )
      throw new Error("Refusing unsafe temporary-directory cleanup");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("canonical configuration initialization and command preflight", () => {
  it.each([0, 1, 2])(
    "cancels initialization at prompt %s without writing a file",
    async (stage) => {
      const directory = await temporary();
      const destination = join(directory, "config.yaml");
      const cancelled = Symbol("cancel");
      vi.mocked(prompts.text).mockResolvedValueOnce(stage === 0 ? cancelled : "client-app");
      if (stage > 0)
        vi.mocked(prompts.select).mockResolvedValueOnce(stage === 1 ? cancelled : true);
      if (stage > 1) vi.mocked(prompts.text).mockResolvedValueOnce(cancelled);
      await runInit();
      expect(prompts.outro).toHaveBeenCalledWith("Setup cancelled.");
      await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("writes valid starter YAML and refuses to overwrite an existing configuration", async () => {
    const directory = await temporary();
    const destination = join(directory, "nested", "config.yaml");
    const answers = () => {
      vi.mocked(prompts.text)
        .mockResolvedValueOnce("client-app")
        .mockResolvedValueOnce(destination);
      vi.mocked(prompts.select).mockResolvedValueOnce(true);
    };
    answers();
    await runInit();
    const source = await readFile(destination, "utf8");
    expect(parseNordixYaml(source).success).toBe(true);
    answers();
    await expect(runInit()).rejects.toThrow(/File already exists/);
    expect(await readFile(destination, "utf8")).toBe(source);
  });
  it.each([false, true])("initializes valid selector-free YAML with a frontend: %s", (frontend) => {
    const source = createStarterConfiguration("client-app", frontend);
    const result = parseNordixYaml(source);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config.schemaVersion).toBe(2);
    expect(result.config.backends[0]?.modules).toMatchObject({
      examples: { architecture: "clean", entities: ["Example"] },
    });
    expect(result.config.frontends).toHaveLength(frontend ? 1 : 0);
    expect(source).not.toMatch(
      /framework:|plugin:|orm:|styling:|stateManagement:|createRemote: true/,
    );
    expect(result.config.repositories[0]).toMatchObject({
      initializeGit: false,
      createRemote: false,
    });
    expect(() => createStarterConfiguration("Bad Name", frontend)).toThrow(/Project name/);
  });

  it("rejects invalid YAML with a source location before any generation effects", async () => {
    const directory = await temporary();
    const file = join(directory, "invalid.yaml");
    const output = join(directory, "output");
    await writeFile(file, "schemaVersion: 2\nname: [\n");
    const runner = vi.fn();
    await expect(runGenerate(file, output, runner)).rejects.toThrow(
      /YAML_SYNTAX_ERROR.*invalid.yaml:/,
    );
    expect(runner).not.toHaveBeenCalled();
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks unintegrated modular generation without invoking the old global renderer", async () => {
    const directory = await temporary();
    const file = join(directory, "valid.yaml");
    const output = join(directory, "output");
    const source = createStarterConfiguration("client-app", true);
    await writeFile(file, source);
    const runner = vi.fn();
    await expect(runGenerate(file, output, runner)).rejects.toThrow(
      /MODULE_GENERATION_UNAVAILABLE.*no files or external commands/i,
    );
    expect(runner).not.toHaveBeenCalled();
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(file, "utf8")).toBe(source);
  });

  it("presents invalid configuration paths/corrections and nonzero command status", async () => {
    const directory = await temporary();
    const file = join(directory, "invalid.yaml");
    await writeFile(
      file,
      createStarterConfiguration("client-app", false).replace(
        "schemaVersion: 2",
        "schemaVersion: 1",
      ),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await createProgram().parseAsync(["node", "nordixgen", "validate", "-f", file]);
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toMatch(
      /CONFIG_VERSION_UNSUPPORTED.*schemaVersion.*invalid.yaml/,
    );
    process.exitCode = undefined;
    await createProgram().parseAsync([
      "node",
      "nordixgen",
      "generate",
      "-f",
      file,
      "-o",
      join(directory, "out"),
    ]);
    expect(process.exitCode).toBe(1);
    await expect(access(join(directory, "out"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("distinguishes structurally valid configuration from unavailable generation in validate", async () => {
    const directory = await temporary();
    const file = join(directory, "valid.yaml");
    await writeFile(file, createStarterConfiguration("client-app", false));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await createProgram().parseAsync(["node", "nordixgen", "validate", "-f", file]);
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("MODULE_GENERATION_UNAVAILABLE");
  });
});
