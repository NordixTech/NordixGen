import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { intro, isCancel, outro, select, text } from "@clack/prompts";
import {
  formatDiagnostic,
  parseNordixYaml,
  resolveProjectYaml,
  stringifyNordixYaml,
} from "@nordixgen/core";
import { type CommandRunner, runCommand } from "./process.js";

export function createStarterConfiguration(name: string, includeFrontend: boolean): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name))
    throw new Error(
      "Project name must start with a lowercase letter and use lowercase letters, digits and hyphens.",
    );
  return stringifyNordixYaml({
    schemaVersion: 2,
    name,
    version: "1.0.0",
    repositories: [{ name: "app", path: ".", initializeGit: false, createRemote: false }],
    backends: [
      {
        name: "api",
        repository: "app",
        path: "apps/api",
        modules: { examples: { architecture: "clean", entities: ["Example"] } },
      },
    ],
    ...(includeFrontend
      ? {
          frontends: [
            {
              name: "web",
              repository: "app",
              path: "apps/web",
              connectsTo: ["api"],
              access: { mode: "public" },
            },
          ],
        }
      : {}),
    entities: {
      Example: {
        backend: "api",
        fields: { name: { type: "string", required: true } },
        timestamps: { createdAt: true, updatedAt: true },
      },
    },
    endpoints: [],
  });
}
export async function runInit(): Promise<void> {
  intro("Create a NordixGen configuration");
  const name = await text({
    message: "Project name",
    placeholder: "my-project",
    validate: (value) =>
      /^[a-z][a-z0-9-]*$/.test(value)
        ? undefined
        : "Use lowercase letters, digits and hyphens; start with a letter.",
  });
  if (isCancel(name)) {
    outro("Setup cancelled.");
    return;
  }
  const frontend = await select({
    message: "Include a frontend?",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
  });
  if (isCancel(frontend)) {
    outro("Setup cancelled.");
    return;
  }
  const output = await text({
    message: "Configuration path",
    defaultValue: "nordix.config.yaml",
    placeholder: "nordix.config.yaml",
  });
  if (isCancel(output)) {
    outro("Setup cancelled.");
    return;
  }
  if (typeof name !== "string" || typeof frontend !== "boolean" || typeof output !== "string")
    throw new Error("Complete the project name, frontend choice and configuration path.");
  const configuration = createStarterConfiguration(name, frontend);
  const parsed = parseNordixYaml(configuration);
  if (!parsed.success) throw new Error(parsed.diagnostics.map(formatDiagnostic).join("\n"));
  const destination = resolve(output);
  try {
    await access(destination);
    throw new Error(`File already exists: ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, configuration, { encoding: "utf8", flag: "wx" });
  outro(
    `Created ${destination}. Modular generation is not integrated yet; use validate to inspect configuration/readiness.`,
  );
}
export async function runGenerate(
  file: string,
  _output: string,
  _runner: CommandRunner = runCommand,
): Promise<void> {
  const filename = resolve(file);
  const result = resolveProjectYaml(await readFile(filename, "utf8"), filename, {
    requireGeneration: true,
  });
  if (!result.success) throw new Error(result.diagnostics.map(formatDiagnostic).join("\n"));
  throw new Error(
    "No modular generator is integrated. Generation cannot start; no files or commands were emitted.",
  );
}
