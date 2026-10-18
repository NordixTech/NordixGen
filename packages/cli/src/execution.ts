import { access, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  BACKEND_SCAFFOLD_OVERLAYS,
  FRONTEND_SCAFFOLD_OVERLAYS,
  formatDiagnostic,
  generateBackend,
  generateFrontend,
} from "@nordixgen/core";
import type { ResolvedProject } from "@nordixgen/core";
import type { CommandRunner } from "./process.js";
function inside(root: string, path: string) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Output path escapes its repository. Correct the configured application path.");
  return target;
}
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}
async function rejectLinks(path: string) {
  let current = resolve(path);
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(
          "Output paths must not contain symbolic links. Choose a new real directory.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export async function executeGeneration(
  project: ResolvedProject,
  output: string,
  runner: CommandRunner,
) {
  // Prepare every application's files before scaffolding or repository effects.
  const applications = [
    ...Object.values(project.backends).map((backend) => ({
      repository: backend.repository,
      name: backend.name,
      path: backend.path,
      backend: true,
      result: generateBackend(project, backend.name),
    })),
    ...Object.values(project.frontends).map((frontend) => ({
      repository: frontend.repository,
      name: frontend.name,
      path: frontend.path,
      backend: false,
      result: generateFrontend(project, frontend.name),
    })),
  ];
  for (const app of applications)
    if (!app.result.success)
      throw new Error(app.result.diagnostics.map(formatDiagnostic).join("\n"));
  const root = resolve(output);
  await rejectLinks(root);
  if (await exists(root)) {
    if ((await readdir(root)).length)
      throw new Error(
        "Generation requires a new or empty output directory. Choose another destination.",
      );
  }
  await mkdir(root, { recursive: true });
  for (const repository of project.repositories)
    await mkdir(inside(root, repository.path), { recursive: true });
  for (const app of applications) {
    if (!app.result.success) continue;
    const repo = inside(root, app.repository.path);
    const target = inside(repo, app.path);
    await mkdir(dirname(target), { recursive: true });
    const scaffold = app.result.frameworkContext.scaffold;
    await runner(
      scaffold.executable,
      [...scaffold.argumentsBeforeTarget, target, ...scaffold.argumentsAfterTarget],
      repo,
    );
    await mkdir(target, { recursive: true });
    await rejectLinks(target);
    for (const path of app.result.virtualFileSystem.listFiles()) {
      const destination = inside(repo, path);
      await rejectLinks(destination);
      const appRelative = relative(target, destination).replaceAll("\\", "/");
      if (
        (await exists(destination)) &&
        !(app.backend
          ? BACKEND_SCAFFOLD_OVERLAYS.some((path) => path === appRelative)
          : FRONTEND_SCAFFOLD_OVERLAYS.some((path) => path === appRelative))
      )
        throw new Error(
          `Unexpected scaffold file collision at ${appRelative}. Fix the scaffold integration before overwriting this file.`,
        );
    }
    await app.result.virtualFileSystem.emit(repo);
    const packageFile = resolve(target, "package.json");
    const manifest = (await exists(packageFile))
      ? JSON.parse(await readFile(packageFile, "utf8"))
      : { name: app.name, private: true };
    if (app.backend)
      manifest.scripts = {
        ...manifest.scripts,
        "check:boundaries": "node scripts/check-boundaries.mjs",
      };
    manifest.dependencies = { ...manifest.dependencies, ...app.result.runtimeDependencies };
    manifest.devDependencies = {
      ...manifest.devDependencies,
      ...app.result.developmentDependencies,
    };
    await writeFile(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
    if (Object.keys(app.result.runtimeDependencies).length)
      await runner("pnpm", ["install"], target);
    if (app.backend) await runner("pnpm", ["run", "check:boundaries"], target);
  }
  for (const repository of project.repositories) {
    const repo = inside(root, repository.path);
    if (repository.initializeGit) {
      await runner("git", ["init"], repo);
      await runner("git", ["add", "."], repo);
      await runner("git", ["commit", "-m", "Initialize generated project"], repo);
    }
    if (repository.createRemote) {
      const org = project.organizations.find((org) => org.name === repository.organization);
      const slug = org ? `${org.name}/${repository.name}` : repository.name;
      await runner(
        "gh",
        ["repo", "create", slug, "--private", "--source", ".", "--remote", "origin", "--push"],
        repo,
      );
    }
  }
}
