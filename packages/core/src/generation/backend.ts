import { posix } from "node:path";
import { createDiagnostic } from "../diagnostics.js";
import type { ConfigDiagnostic } from "../diagnostics.js";
import { generateApplicationFiles } from "../plugins/architecture/application-files.js";
import { resolveCleanArchitectureLayout } from "../plugins/architecture/clean.js";
import { generateDomainFiles } from "../plugins/architecture/domain-files.js";
import { generateBetterAuthFiles } from "../plugins/authentication/better-auth.js";
import { generateAuthorizationFiles } from "../plugins/authorization/rbac-pbac.js";
import type { BackendRenderContext } from "../plugins/contracts.js";
import { generateHonoFiles } from "../plugins/frameworks/hono-files.js";
import { backendPaths } from "../plugins/frameworks/hono.js";
import { generateDrizzleFiles } from "../plugins/orms/drizzle.js";
import type { ResolvedProject } from "../project/types.js";
import { backendView } from "../project/views.js";
import { backendDependencies } from "./dependencies.js";
import { collectFiles } from "./files.js";

export function backendRenderContext(project: ResolvedProject, name: string): BackendRenderContext {
  const domainModel = backendView(project, name);
  const backend = domainModel.backend;
  const framework = backendPaths(backend.path);
  const architecture = resolveCleanArchitectureLayout(framework);
  return {
    framework,
    architecture,
    domainModel,
    identity: backend.identity,
    projectName: project.project.name,
    ...(backend.database
      ? {
          persistence: {
            database: backend.database,
            directories: {
              infrastructure: posix.join(
                framework.codeRoot,
                architecture.directories.infrastructure,
              ),
              adapter: posix.join(framework.codeRoot, architecture.directories.adapter),
            },
            connectionStringEnvironmentVariable: "DATABASE_URL" as const,
          },
        }
      : {}),
  };
}
export function generateBackend(project: ResolvedProject, name: string) {
  const view = backendView(project, name);
  const errors: readonly ConfigDiagnostic[] = project.readiness.filter(
    (d) =>
      d.path === view.backend.origin.path ||
      d.path.startsWith(`${view.backend.origin.path}.`) ||
      Object.values(view.entities).some((e) => d.path.startsWith(`${e.origin.path}.`)),
  );
  if (errors.length) return { success: false as const, diagnostics: errors };
  const context = backendRenderContext(project, name);
  const contributions = [
    { owner: "clean-domain", files: generateDomainFiles(context) },
    { owner: "clean-application", files: generateApplicationFiles(context) },
    ...(context.persistence ? [{ owner: "drizzle", files: generateDrizzleFiles(context) }] : []),
    ...(context.identity
      ? [
          { owner: "better-auth", files: generateBetterAuthFiles(context) },
          { owner: "authorization", files: generateAuthorizationFiles(context) },
        ]
      : []),
    { owner: "hono-assembly", files: generateHonoFiles(context) },
    {
      owner: "backend-runtime",
      files: [
        {
          path: posix.join(view.backend.path, "wrangler.jsonc"),
          content: `${JSON.stringify({ name: view.backend.name, main: "src/index.ts", compatibility_date: "2025-04-01", compatibility_flags: ["nodejs_compat"] }, null, 2)}\n`,
        },
      ],
    },
  ];
  return {
    success: true as const,
    virtualFileSystem: collectFiles(view.backend.path, contributions),
    frameworkContext: context.framework,
    ...backendDependencies(Boolean(context.persistence), Boolean(context.identity)),
    diagnostics: [] as ConfigDiagnostic[],
  };
}
