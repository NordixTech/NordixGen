import { intro, outro } from "@clack/prompts";
import { getCoreInfo } from "@nordixgen/core";
import { Command } from "commander";
import pc from "picocolors";

export const CLI_VERSION = "0.1.0";

/**
 * Checks runtime Node version and warns if < 24
 */
export function checkNodeRuntime(): boolean {
  const currentMajor = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  if (currentMajor < 24) {
    console.error(
      pc.yellow(
        `\n⚠️  Warning: NordixGen requires Node.js >= 24.0.0 (Current: ${process.version}).`,
      ),
    );
    console.error(pc.dim("Please update with fnm (`fnm install 24 && fnm use 24`) or nvm.\n"));
    return false;
  }
  return true;
}

export function createProgram(): Command {
  const program = new Command();
  const coreInfo = getCoreInfo();

  program
    .name("nordixgen")
    .description(
      "Declarative & deterministic architecture & scaffolding engine for full-stack projects",
    )
    .version(`CLI: ${CLI_VERSION} | Core: ${coreInfo.version}`);

  program
    .command("info")
    .description("Display NordixGen runtime environment and active core engine details")
    .action(() => {
      checkNodeRuntime();
      intro(pc.cyan("⚡ NordixGen Platform"));
      console.log(pc.bold("Node.js Runtime : ") + pc.green(process.version));
      console.log(pc.bold("CLI Version     : ") + pc.green(CLI_VERSION));
      console.log(
        pc.bold("Core Engine     : ") + pc.green(`${coreInfo.engine} (v${coreInfo.version})`),
      );
      console.log(pc.bold("Status          : ") + pc.green("Ready for Phase 2 Engine"));
      outro(pc.cyan("https://github.com/NordixTech/NordixGen"));
    });

  return program;
}

// Auto-run if executed directly as a script
if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  checkNodeRuntime();
  const program = createProgram();
  program.parse(process.argv);
}
