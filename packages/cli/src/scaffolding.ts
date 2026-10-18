import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  BACKEND_SCAFFOLD_OVERLAYS,
  FRONTEND_SCAFFOLD_OVERLAYS,
  WORKSPACE_TOOLING,
} from "@nordixgen/core";
import { exists, inside, rejectLinks } from "./filesystem.js";
import type { PreparedApplication } from "./generation-types.js";
import { type CommandRunner, checkedCommand, safeFailure } from "./process.js";
import { applicationManifest, applicationTypeScript } from "./workspace.js";

const omitted = new Set([
  "node_modules",
  ".git",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
]);
/** Hono's pinned CLI installs internally. Fence it in disposable staging, then copy source only. */
export async function scaffoldApplication(
  app: PreparedApplication,
  root: string,
  version: string,
  runner: CommandRunner,
): Promise<void> {
  const staging = await mkdtemp(join(root, ".nordixgen-scaffold-"));
  if (!resolve(staging).startsWith(`${resolve(root)}${sep}.nordixgen-scaffold-`))
    throw Error("Unsafe scaffold staging directory.");
  try {
    await writeFile(join(staging, "pnpm-workspace.yaml"), 'packages:\n  - "app"\n');
    await writeFile(
      join(staging, "package.json"),
      JSON.stringify({
        name: "nordixgen-scaffold",
        private: true,
        packageManager: WORKSPACE_TOOLING.packageManager,
      }),
    );
    await checkedCommand(
      runner,
      app.scaffold.executable,
      [...app.scaffold.argumentsBeforeTarget, "app", ...app.scaffold.argumentsAfterTarget],
      staging,
      `Scaffolding application "${app.name}" failed`,
    );
    const source = inside(staging, "app");
    await mkdir(source, { recursive: true });
    await rejectLinks(source);
    const generatedPrefix = app.path === "." ? "" : `${app.path}/`;
    for (const file of app.files.listFiles()) {
      const name = file.slice(generatedPrefix.length);
      const destination = inside(source, name);
      await rejectLinks(destination);
      if (
        (await exists(destination)) &&
        !(app.backend ? BACKEND_SCAFFOLD_OVERLAYS : FRONTEND_SCAFFOLD_OVERLAYS).some(
          (overlay) => overlay === name,
        )
      )
        throw Error(
          `Unexpected scaffold file collision at ${name}. Fix the scaffold integration before overwriting this file.`,
        );
    }
    const packageFile = join(source, "package.json");
    const tsFile = join(source, "tsconfig.json");
    if (!(await exists(packageFile)) || !(await exists(tsFile)))
      throw Error(
        "The upstream scaffold did not produce package.json and tsconfig.json. No installation or repository publication will follow.",
      );
    await rejectLinks(packageFile);
    await rejectLinks(tsFile);
    const manifest = applicationManifest(
      JSON.parse(await readFile(packageFile, "utf8")),
      app,
      version,
    );
    const config = applicationTypeScript(await readFile(tsFile, "utf8"), app.backend);
    const repository = inside(root, app.repository.path);
    const target = inside(repository, app.path);
    await mkdir(dirname(target), { recursive: true });
    await rejectLinks(target);
    await cp(source, target, {
      recursive: true,
      filter: async (path) => {
        if (omitted.has(basename(path))) return false;
        if ((await lstat(path)).isSymbolicLink())
          throw Error(
            "The scaffold contains an unsupported symbolic link. No external link will be copied.",
          );
        return true;
      },
    });
    await app.files.emit(repository);
    await writeFile(join(target, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(target, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
  } catch (error) {
    throw Error(`Application "${app.name}" preparation failed: ${safeFailure(error)}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
