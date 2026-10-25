import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import * as prompts from "@clack/prompts";
import { parseNordixYaml, stringifyNordixYaml } from "@nordixgen/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureCommand } from "../tests/scaffold-fixture.js";
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
  it.each([
    ["cycle", "RELATION_CYCLE"],
    ["association", "RELATION_MAPPING_UNIMPLEMENTED"],
  ])(
    "uses identical located resolution diagnostics in validate/generate for %s",
    async (kind, code) => {
      const parsed = parseNordixYaml(createStarterConfiguration("client-app", false));
      if (!parsed.success) throw new Error("Invalid initialization fixture");
      if (kind === "cycle" || kind === "association")
        parsed.config.entities.Example.relations.related = {
          type: kind === "cycle" ? "many-to-one" : "many-to-many",
          target: "Example",
          required: false,
        };
      else
        parsed.config.backends[0].modules.examples.architecture = kind as
          | "clean"
          | "hexagonal"
          | "onion";
      const directory = await temporary();
      const file = join(directory, "configuration.yaml");
      const output = join(directory, "output");
      await writeFile(file, stringifyNordixYaml(parsed.config));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await createProgram().parseAsync(["node", "nordixgen", "validate", "-f", file]);
      const validation = stripVTControlCharacters(error.mock.calls.flat().join("\n"));
      expect(process.exitCode).toBe(1);
      expect(validation).toContain(code);
      expect(validation).toContain("configuration.yaml:");
      error.mockClear();
      process.exitCode = undefined;
      await createProgram().parseAsync(["node", "nordixgen", "generate", "-f", file, "-o", output]);
      expect(process.exitCode).toBe(1);
      expect(stripVTControlCharacters(error.mock.calls.flat().join("\n"))).toBe(validation);
      await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
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
      initializeGit: true,
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

  it.each(["clean", "hexagonal", "onion"])(
    "generates a %s backend through the injected runner and preserves the config",
    async (architecture) => {
      const directory = await temporary();
      const file = join(directory, "valid.yaml");
      const output = join(directory, "output");
      const source = createStarterConfiguration("client-app", true).replace(
        "architecture: clean",
        `architecture: ${architecture}`,
      );
      await writeFile(file, source);
      const runner = vi.fn(fixtureCommand);
      await runGenerate(file, output, runner);
      expect(runner.mock.calls.some((call) => call[0] === "pnpm")).toBe(true);
      expect(await readFile(join(output, "apps/api/src/index.ts"), "utf8")).toContain("new Hono");
      expect(await readFile(join(output, "apps/web/src/app/providers.tsx"), "utf8")).toContain(
        "QueryClientProvider",
      );
      const pkg = JSON.parse(await readFile(join(output, "apps/api/package.json"), "utf8"));
      expect(pkg.dependencies.hono).toBe("^4.13.14");
      expect(pkg.dependencies["@hono/zod-validator"]).toBe("^0.9.1");
      expect(pkg.engines.node).toBe(">=24.22.1");
      const web = JSON.parse(await readFile(join(output, "apps/web/package.json"), "utf8"));
      expect(web.dependencies.next).toBe("16.4.3");
      expect(web.dependencies.sharp).toBe("0.35.5");
      const workspace = JSON.parse(await readFile(join(output, "package.json"), "utf8"));
      expect(workspace.pnpm.overrides.esbuild).toBe("0.28.2");
      expect(workspace.pnpm.overrides.zod).toBe("4.6.7");
      expect(pkg.devDependencies).toHaveProperty("typescript");
      expect(await readFile(file, "utf8")).toBe(source);
      await expect(runGenerate(file, output, runner)).rejects.toThrow(/new or empty/);
    },
  );

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

  it.each(["clean", "hexagonal", "onion"])(
    "accepts %s generation in validate",
    async (architecture) => {
      const directory = await temporary();
      const file = join(directory, "valid.yaml");
      await writeFile(
        file,
        createStarterConfiguration("client-app", false).replace(
          "architecture: clean",
          `architecture: ${architecture}`,
        ),
      );
      await createProgram().parseAsync(["node", "nordixgen", "validate", "-f", file]);
      expect(process.exitCode).toBeUndefined();
    },
  );
});

describe("modular generation execution", () => {
  it("emits two Clean modules into one scaffold and runs the generated boundary check", async () => {
    const directory = await temporary();
    const file = join(directory, "modular.yaml");
    const output = join(directory, "output");
    const source = await readFile(
      new URL("../../../examples/configuration/clean-modules.yaml", import.meta.url),
      "utf8",
    );
    const parsed = parseNordixYaml(source);
    if (!parsed.success) throw new Error("Invalid modular fixture");
    await writeFile(file, stringifyNordixYaml(parsed.config));
    const runner = vi.fn(fixtureCommand);
    await runGenerate(file, output, runner);
    expect(
      await readFile(
        join(output, "apps/api/src/modules/customers/domain/entities/Customer.entity.ts"),
        "utf8",
      ),
    ).toContain("interface Customer");
    expect(
      await readFile(
        join(output, "apps/api/src/modules/billing/domain/entities/Invoice.entity.ts"),
        "utf8",
      ),
    ).toContain("interface Invoice");
    expect(runner.mock.calls.filter((call) => call[1]?.includes("hono@0.19.5"))).toHaveLength(1);
    expect(runner.mock.calls.some((call) => call[1]?.join(" ") === "run check:boundaries")).toBe(
      true,
    );
  });
});
