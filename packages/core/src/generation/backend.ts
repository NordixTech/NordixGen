import { posix } from "node:path";
import type { ConfigDiagnostic } from "../diagnostics.js";
import { generateApplicationFiles } from "../plugins/architecture/application-files.js";
import { resolveCleanArchitectureLayout } from "../plugins/architecture/clean.js";
import { generateDomainFiles } from "../plugins/architecture/domain-files.js";
import { resolveArchitectureLayout } from "../plugins/architecture/layout.js";
import { generateBetterAuthFiles } from "../plugins/authentication/better-auth.js";
import { generateAuthorizationFiles } from "../plugins/authorization/roles-permissions.js";
import type { BackendRenderContext } from "../plugins/contracts.js";
import { generateHonoFiles } from "../plugins/frameworks/hono-files.js";
import { backendPaths } from "../plugins/frameworks/hono.js";
import {
  generateDrizzleAdapterFiles,
  generateDrizzleSchemaFiles,
} from "../plugins/orms/drizzle-files.js";
import { generateDrizzleFiles } from "../plugins/orms/drizzle.js";
import type { ResolvedProject } from "../project/types.js";
import { backendView } from "../project/views.js";
import { AI_STACK, MCP_STACK, generateAiFiles } from "./ai.js";
import { generateApplicationRuntime } from "./application-runtime.js";
import { generateAuditFiles } from "./audit.js";
import { generateBoundaryCheck } from "./boundaries.js";
import { cloudflareConfiguration } from "./cloudflare.js";
import { backendDependencies } from "./dependencies.js";
import { collectFiles } from "./files.js";
import { generateLocalRuntime } from "./local-runtime.js";
import { generateModuleComposition } from "./module-composition.js";
import { generateModulePublicFiles } from "./module-public.js";
import { backendEnvironmentFile } from "./runtime-environment.js";
import { storageFiles } from "./storage.js";

export function backendRenderContext(project: ResolvedProject, name: string): BackendRenderContext {
  const domainModel = backendView(project, name);
  const backend = domainModel.backend;
  const framework = backendPaths(backend.path);
  const clean = resolveCleanArchitectureLayout();
  const architecture = {
    ...clean,
    directories: {
      ...clean.directories,
      infrastructure: "platform",
      adapter: "platform/database",
      controller: "platform/http/controllers",
    },
  };
  return {
    framework,
    architecture,
    domainModel,
    identity: backend.identity,
    projectName: project.project.name,
    platformRoot: posix.join(framework.codeRoot, "platform"),
    moduleRoots: Object.fromEntries(
      domainModel.modules.map((module) => [
        module.id,
        posix.join(framework.codeRoot, "modules", module.name),
      ]),
    ),
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
              schema: posix.join(framework.codeRoot, "platform/database/schema"),
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
    { owner: "ai", files: generateAiFiles(context) },
    ...view.modules.flatMap((module) => {
      const scoped = moduleRenderContext(project, name, module.id);
      // Each module selects its built-in dependency layout; shared assembly stays single-owned.
      return [
        { owner: `${module.id}:domain`, files: generateDomainFiles(scoped) },
        { owner: `${module.id}:application`, files: generateApplicationFiles(scoped) },
        ...(scoped.persistence
          ? [
              {
                owner: `${module.id}:persistence`,
                files: [
                  ...generateDrizzleSchemaFiles(scoped, scoped.persistence),
                  ...generateDrizzleAdapterFiles(scoped, scoped.persistence),
                ],
              },
            ]
          : []),
        {
          owner: `${module.id}:public-application`,
          files: generateModulePublicFiles(project, scoped),
        },
      ];
    }),
    ...(context.persistence
      ? [
          {
            owner: "drizzle",
            files: [...generateDrizzleFiles(context), ...generateAuditFiles(context)],
          },
        ]
      : []),
    ...(context.identity
      ? [
          { owner: "better-auth", files: generateBetterAuthFiles(context) },
          { owner: "authorization", files: generateAuthorizationFiles(context) },
        ]
      : []),
    { owner: "storage", files: storageFiles(project, name) },
    { owner: "hono-assembly", files: generateHonoFiles(context) },
    { owner: "module-boundary-check", files: [generateBoundaryCheck(context)] },
    { owner: "application-runtime", files: generateApplicationRuntime(context) },
    { owner: "local-runtime", files: generateLocalRuntime(context) },
    ...(context.persistence
      ? [
          {
            owner: "backend-module-composition",
            files: [generateModuleComposition(project, context)],
          },
        ]
      : []),
    {
      owner: "backend-runtime",
      files: [
        backendEnvironmentFile(context),
        {
          path: posix.join(view.backend.path, "wrangler.jsonc"),
          content: `${JSON.stringify(cloudflareConfiguration(context.projectName, view.backend.name, false, [], view.backend.storage), null, 2)}\n`,
        },
      ],
    },
  ];
  return {
    success: true as const,
    virtualFileSystem: collectFiles(view.backend.path, contributions),
    frameworkContext: context.framework,
    ...backendDependencies(Boolean(context.persistence), Boolean(context.identity)),
    ...(view.backend.ai
      ? {
          runtimeDependencies: {
            ...backendDependencies(Boolean(context.persistence), Boolean(context.identity))
              .runtimeDependencies,
            ...AI_STACK,
            ...(view.backend.ai.mcp.enabled ? MCP_STACK : {}),
            ...(view.backend.storage.length ? { miniflare: "4.20260730.0" } : {}),
          },
        }
      : {}),
    ...(view.backend.storage.length && !view.backend.ai
      ? {
          runtimeDependencies: {
            ...backendDependencies(Boolean(context.persistence), Boolean(context.identity))
              .runtimeDependencies,
            miniflare: "4.20260730.0",
          },
        }
      : {}),
    diagnostics: [] as ConfigDiagnostic[],
  };
}

export function moduleRenderContext(
  project: ResolvedProject,
  name: string,
  moduleId: string,
): BackendRenderContext {
  const parent = backendRenderContext(project, name);
  const module = project.modules[moduleId];
  if (!module || module.backend !== name)
    throw new Error("UNKNOWN_MODULE_TARGET: Select a module owned by this backend.");
  const codeRoot = parent.moduleRoots[moduleId];
  const framework = { ...parent.framework, codeRoot };
  const architecture = resolveArchitectureLayout(module.architecture);
  const entities = Object.fromEntries(
    module.entities.map((name) => [name, project.entities[name]]),
  );
  const enumNames = new Set(
    Object.values(entities).flatMap((entity) =>
      Object.values(entity.fields).flatMap((field) =>
        field.type === "enum" ? [field.enumName] : [],
      ),
    ),
  );
  return {
    ...parent,
    moduleId,
    framework,
    architecture,
    sharedDatabaseFile: posix.join(codeRoot, architecture.databaseClient),
    domainModel: {
      ...parent.domainModel,
      entities,
      enums: Object.fromEntries(
        Object.entries(project.enums).filter(([name]) => enumNames.has(name)),
      ),
      endpoints: module.operations.map((id) => project.operations[id]),
      entityOrder: parent.domainModel.entityOrder.filter((name) => module.entities.includes(name)),
      modules: [module],
    },
    ...(parent.persistence
      ? {
          persistence: {
            ...parent.persistence,
            directories: {
              infrastructure: parent.platformRoot,
              adapter: posix.join(codeRoot, architecture.directories.adapter),
              schema: posix.join(codeRoot, architecture.schema),
            },
          },
        }
      : {}),
  };
}
