import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { intro, isCancel, outro, select, text } from "@clack/prompts";
import { formatDiagnostic, resolveProjectYaml, stringifyNordixYaml } from "@nordixgen/core";
import { executeGeneration } from "./execution.js";
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
    databases: { primary: {} },
    backends: [
      {
        name: "api",
        repository: "app",
        path: "apps/api",
        modules: { examples: { architecture: "clean", entities: ["Example"] } },
        persistence: { database: "primary" },
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
        fields: { name: { type: "string", required: true, minLength: 1, maxLength: 120 } },
        timestamps: { createdAt: true, updatedAt: true },
      },
    },
    pagination: { standard: {} },
    endpoints: [
      {
        backend: "api",
        entity: "Example",
        operationId: "listExamples",
        method: "GET",
        path: "/api/examples",
        authRequired: false,
        pagination: "standard",
        queryParams: [
          {
            name: "search",
            field: { entity: "Example", field: "name" },
            operator: "contains",
            required: false,
          },
        ],
      },
      {
        backend: "api",
        entity: "Example",
        operationId: "createExample",
        method: "POST",
        path: "/api/examples",
        authRequired: false,
        requestBody: { useCase: { entity: "Example", operation: "create" } },
      },
    ],
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
  const parsed = resolveProjectYaml(configuration, undefined, { requireGeneration: true });
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
  outro(`Created ${destination}. Use validate to inspect configuration and generation readiness.`);
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
  for (const diagnostic of result.diagnostics) console.warn(formatDiagnostic(diagnostic));
  await executeGeneration(result.project, _output, _runner);
}
