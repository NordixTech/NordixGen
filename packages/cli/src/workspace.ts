import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ResolvedProject, WORKSPACE_TOOLING } from "@nordixgen/core";
import { type ParseError, parse } from "jsonc-parser";
import { exists } from "./filesystem.js";
import type { PreparedApplication } from "./generation-types.js";
interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [name: string]: unknown;
}
function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== "string")
  )
    throw Error(`The scaffold ${label} must be an object of string values.`);
  return { ...value } as Record<string, string>;
}
export function applicationManifest(
  input: unknown,
  app: PreparedApplication,
  version: string,
): Manifest {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("The scaffold package.json must contain an object.");
  const manifest = { ...input } as Manifest;
  const runtime = stringRecord(manifest.dependencies, "dependencies");
  const development = stringRecord(manifest.devDependencies, "devDependencies");
  const scripts = stringRecord(manifest.scripts, "scripts");
  // Direct renderer dependencies own their category/version. Preserve unrelated upstream entries.
  for (const [name, version] of Object.entries(app.runtime)) {
    delete development[name];
    runtime[name] = version;
  }
  for (const [name, version] of Object.entries(app.development)) {
    delete runtime[name];
    development[name] = version;
  }
  for (const name of Object.keys(runtime))
    if (Object.hasOwn(development, name))
      throw Error(
        `Scaffold dependency "${name}" is duplicated across runtime and development categories. Correct the upstream integration.`,
      );
  const required = {
    typecheck: app.backend ? "tsc --noEmit" : "next typegen && tsc --noEmit",
    ...(app.backend ? { "check:boundaries": "node scripts/check-boundaries.mjs" } : {}),
    ...(app.database
      ? {
          "db:generate": "drizzle-kit generate",
          "db:migrate": "tsx src/platform/database/migrate.ts",
          "db:seed": "tsx src/platform/database/seed.ts",
          ...(app.runtime["better-auth"]
            ? { "auth:create-admin": "tsx src/platform/authorization/create-admin.ts" }
            : {}),
        }
      : {}),
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== undefined && scripts[name] !== command)
      throw Error(
        `Unexpected scaffold script collision at "${name}". Correct the integration before replacing it.`,
      );
    scripts[name] = command;
  }
  return {
    ...manifest,
    name: app.name,
    version,
    private: true,
    packageManager: WORKSPACE_TOOLING.packageManager,
    engines: { ...stringRecord(manifest.engines, "engines"), node: WORKSPACE_TOOLING.node },
    scripts,
    dependencies: runtime,
    devDependencies: development,
  };
}
export function applicationTypeScript(source: string, backend: boolean): unknown {
  const errors: ParseError[] = [];
  const config: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config))
    throw Error("The scaffold tsconfig.json is invalid JSON/JSONC. Correct the integration.");
  const settings = config as Record<string, unknown>;
  const previous = settings.compilerOptions;
  if (
    previous !== undefined &&
    (!previous || typeof previous !== "object" || Array.isArray(previous))
  )
    throw Error("The scaffold compilerOptions must be an object.");
  const options = { ...(previous as Record<string, unknown>) };
  if (backend) {
    const types = options.types;
    if (
      types !== undefined &&
      (!Array.isArray(types) || types.some((item) => typeof item !== "string"))
    )
      throw Error("Scaffold compilerOptions.types must contain type package names.");
    options.types = [...new Set([...((types as string[] | undefined) ?? []), "node"])];
  }
  // Check generated application source strictly; third-party SDK declarations are external contracts.
  return { ...settings, compilerOptions: { ...options, strict: true, skipLibCheck: true } };
}
export async function finishWorkspace(
  project: ResolvedProject,
  repository: ResolvedProject["repositories"][number],
  directory: string,
  apps: readonly PreparedApplication[],
): Promise<void> {
  const rootApplication = apps.some((app) => app.path === ".");
  if (!rootApplication)
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: repository.name, version: project.project.version, private: true, packageManager: WORKSPACE_TOOLING.packageManager, engines: { node: WORKSPACE_TOOLING.node }, scripts: { dev: "pnpm -r --parallel --if-present dev", build: "pnpm -r --if-present build", typecheck: "pnpm -r --if-present typecheck", "check:boundaries": "pnpm -r --if-present check:boundaries" } }, null, 2)}\n`,
    );
  await writeFile(
    join(directory, "pnpm-workspace.yaml"),
    `packages:\n${apps.map((app) => `  - ${JSON.stringify(app.path)}`).join("\n")}\n`,
  );
  const ignore = join(directory, ".gitignore");
  const previous = (await exists(ignore)) ? await readFile(ignore, "utf8") : "";
  await writeFile(
    ignore,
    `${previous.trimEnd()}\n\n# Generated workspace outputs and local runtime secrets\nnode_modules/\ndist/\n.next/\n.wrangler/\n.env\n.env.*\n!.env.example\n.dev.vars\n.dev.vars.*\n!.dev.vars.example\n`,
  );
  await writeFile(
    join(directory, "README.md"),
    [
      `# ${project.project.name} — ${repository.name}`,
      "",
      `Requires Node.js ${WORKSPACE_TOOLING.node} and ${WORKSPACE_TOOLING.packageManager}.`,
      "",
      "## Applications",
      ...apps.map(
        (app) =>
          `- \`${app.name}\`: \`${app.path}\` (${app.backend ? "Hono modular backend" : "Next.js App Router frontend"}).`,
      ),
      "",
      "Dependencies are installed and application TypeScript/boundary checks run during generation.",
      "",
      "## Local setup",
      "- Backends: copy `.dev.vars.example` to `.dev.vars` inside the application and set the indicated runtime values. These files are ignored; never commit real credentials.",
      "- Database tooling runs in Node: also provide `DATABASE_URL` in your shell before `pnpm db:migrate` or `pnpm db:seed`. Generate SQL with `pnpm db:generate`, review it, then migrate before serving business/auth requests. Seeds create synthetic business data, not login identities.",
      "- With authentication enabled, migrations also initialize database roles and grants without overwriting existing role edits. Register the first operator normally, then run `pnpm auth:create-admin operator@example.com` in the backend to promote that existing account. `/admin/roles` exposes permission-protected role/user administration; signup never accepts an elevated role.",
      "- Frontends: copy `.env.example` to `.env.local` and configure every backend origin. For a single local backend, use `http://localhost:8787`; Next.js normally uses `http://localhost:3000`.",
      "- With auth disabled, set backend `CORS_ALLOWED_ORIGINS` to the exact frontend origins. With Better Auth, use its `BETTER_AUTH_URL` / `AUTH_TRUSTED_ORIGINS` settings. CORS is a browser transport control, not business authorization.",
      "- Multiple backends need distinct local ports and matching public/identity URLs. Do not forward session cookies to a different authority or assume cookies cross unrelated hostnames.",
      "",
      "Run `pnpm dev` in an application (or in a multi-application workspace). Use `pnpm typecheck` and backend `pnpm check:boundaries` after changes. Build frontends with `pnpm build`.",
      "",
      "Generation initializes a new project. Existing edited projects are not overwritten or regenerated. Repository publication occurs only when explicitly configured; external failures may leave a partial local output for inspection.",
      "",
    ].join("\n"),
  );
}
