import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { intro, outro, spinner } from "@clack/prompts";
import { formatDiagnostic, getCoreInfo, resolveProjectYaml } from "@nordixgen/core";
import { Command } from "commander";
import pc from "picocolors";
import { runGenerate, runInit } from "./orchestrator.js";

export const CLI_VERSION = "0.1.0";

export function checkNodeRuntime(): boolean {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 24) {
    console.error(pc.yellow(`NordixGen requires Node.js >= 24.0.0 (current: ${process.version}).`));
    return false;
  }
  return true;
}

export function createProgram(): Command {
  const program = new Command();
  const coreInfo = getCoreInfo();
  program
    .name("nordixgen")
    .description("Initialize fixed-stack full-stack projects from YAML v2")
    .version(CLI_VERSION);

  program
    .command("info")
    .description("Display NordixGen runtime and core engine versions")
    .action(() => {
      intro(pc.cyan("NordixGen"));
      console.log(`${pc.bold("Node.js Runtime:")} ${process.version}`);
      console.log(`${pc.bold("CLI Version:")} ${CLI_VERSION}`);
      console.log(`${pc.bold("Core Engine:")} ${coreInfo.engine} (v${coreInfo.version})`);
      outro("https://github.com/NordixTech/NordixGen");
    });

  program
    .command("validate")
    .description("Validate YAML v2 and supported generation readiness")
    .requiredOption("-f, --file <file>", "Configuration YAML file")
    .action(async ({ file }: { file: string }) => {
      const task = spinner();
      task.start(`Validating ${file}`);
      try {
        const filename = resolve(file);
        const result = resolveProjectYaml(await readFile(filename, "utf8"), filename, {
          requireGeneration: true,
        });
        if (!result.success) {
          task.stop(
            result.diagnostics.some((d) => d.code === "RELATION_MAPPING_UNIMPLEMENTED")
              ? "Configuration is valid; generation is not ready"
              : "Configuration is invalid",
          );
          for (const diagnostic of result.diagnostics) {
            console.error(pc.red(formatDiagnostic(diagnostic)));
          }
          process.exitCode = 1;
          return;
        }
        task.stop("Configuration is valid");
        console.log(`Project: ${result.project.project.name} v${result.project.project.version}`);
        console.log(
          `Repositories: ${result.project.repositories.length}; frontends: ${Object.keys(result.project.frontends).length}; backends: ${Object.keys(result.project.backends).length}; entities: ${Object.keys(result.project.entities).length}; endpoints: ${Object.keys(result.project.operations).length}`,
        );
        for (const diagnostic of result.diagnostics) {
          console.warn(pc.yellow(formatDiagnostic(diagnostic)));
        }
      } catch (error) {
        task.stop("Validation failed");
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  program
    .command("init")
    .description("Create a starter nordix.config.yaml interactively")
    .action(async () => {
      try {
        await runInit();
      } catch (error) {
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  program
    .command("generate")
    .description("Scaffold applications described in a NordixGen YAML configuration")
    .requiredOption("-f, --file <file>", "Configuration YAML file")
    .requiredOption("-o, --output <directory>", "Empty or new output directory")
    .action(async ({ file, output }: { file: string; output: string }) => {
      intro(pc.cyan("NordixGen project generation"));
      try {
        await runGenerate(file, output);
      } catch (error) {
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  return program;
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  if (!checkNodeRuntime()) process.exitCode = 1;
  else void createProgram().parseAsync(process.argv);
}
