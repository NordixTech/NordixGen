import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ResolvedProject,
  formatDiagnostic,
  generateBackend,
  generateFrontend,
} from "@nordixgen/core";
import { ensureNewOrEmpty, existingParent, inside } from "./filesystem.js";
import type { PreparedApplication } from "./generation-types.js";
import { type CommandRunner, checkedCommand } from "./process.js";
import { checkPrerequisites, finishRepositories } from "./repositories.js";
import { scaffoldApplication } from "./scaffolding.js";
import { finishWorkspace } from "./workspace.js";

export function prepareApplications(project: ResolvedProject): readonly PreparedApplication[] {
  const prepare = (
    name: string,
    path: string,
    repository: PreparedApplication["repository"],
    backend: boolean,
    database: boolean,
    result: ReturnType<typeof generateBackend> | ReturnType<typeof generateFrontend>,
  ): PreparedApplication => {
    if (!result.success) throw Error(result.diagnostics.map(formatDiagnostic).join("\n"));
    return {
      name,
      path,
      repository,
      backend,
      database,
      files: result.virtualFileSystem,
      scaffold: result.frameworkContext.scaffold,
      runtime: result.runtimeDependencies,
      development: result.developmentDependencies,
    };
  };
  return [
    ...Object.values(project.backends).map((backend) =>
      prepare(
        backend.name,
        backend.path,
        backend.repository,
        true,
        Boolean(backend.database),
        generateBackend(project, backend.name),
      ),
    ),
    ...Object.values(project.frontends).map((frontend) =>
      prepare(
        frontend.name,
        frontend.path,
        frontend.repository,
        false,
        false,
        generateFrontend(project, frontend.name),
      ),
    ),
  ];
}
export async function executeGeneration(
  project: ResolvedProject,
  output: string,
  runner: CommandRunner,
): Promise<void> {
  const applications = prepareApplications(project);
  const root = resolve(output);
  await ensureNewOrEmpty(root);
  // Resolve every destination before any avoidable scaffolder, install or repository side effect.
  for (const app of applications) inside(inside(root, app.repository.path), app.path);
  const settings = await checkPrerequisites(project, await existingParent(root), runner);
  await mkdir(root, { recursive: true });
  for (const repository of project.repositories)
    await mkdir(inside(root, repository.path), { recursive: true });
  for (const app of applications) {
    console.log(`Preparing application "${app.name}"...`);
    await scaffoldApplication(app, root, project.project.version, runner);
  }
  for (const repository of project.repositories) {
    const directory = inside(root, repository.path);
    const apps = applications.filter((app) => app.repository.name === repository.name);
    await finishWorkspace(project, repository, directory, apps);
    await checkedCommand(
      runner,
      "pnpm",
      ["install", "--no-frozen-lockfile"],
      directory,
      `Repository "${repository.name}" dependency installation failed`,
    );
  }
  for (const app of applications) {
    const directory = inside(inside(root, app.repository.path), app.path);
    await checkedCommand(
      runner,
      "pnpm",
      ["run", "typecheck"],
      directory,
      `Application "${app.name}" TypeScript verification failed`,
    );
    if (app.backend)
      await checkedCommand(
        runner,
        "pnpm",
        ["run", "check:boundaries"],
        directory,
        `Application "${app.name}" module-boundary verification failed`,
      );
  }
  console.log("Local generation and application checks completed.");
  await finishRepositories(project, root, settings, runner);
}
