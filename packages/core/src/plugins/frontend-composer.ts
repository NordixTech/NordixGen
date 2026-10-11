import type { FrontendDefinition } from "../configuration/schema.js";
import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import { VirtualFileSystem, normalizeVirtualPath } from "../virtual-file-system.js";
import type { GeneratedFile } from "./contracts.js";
import type { FrontendFrameworkContext, FrontendGeneratorPlugin } from "./frontend-contracts.js";
import type { FrontendPluginRegistry } from "./frontend-registry.js";

export type FrontendPluginCompositionResult =
  | {
      success: true;
      virtualFileSystem: VirtualFileSystem;
      frameworkContext: FrontendFrameworkContext;
      runtimeDependencies: Readonly<Record<string, string>>;
      developmentDependencies: Readonly<Record<string, string>>;
      diagnostics: ConfigDiagnostic[];
    }
  | { success: false; diagnostics: ConfigDiagnostic[] };

function fail(diagnostics: ConfigDiagnostic[]): FrontendPluginCompositionResult {
  return { success: false, diagnostics };
}

function frameworkPluginId(framework: string): string {
  return framework.toLowerCase() === "next.js" ? "nextjs" : framework.toLowerCase();
}

function validateFrameworkContext(
  context: FrontendFrameworkContext,
  expectedPluginId: string,
  applicationRoot: string,
): void {
  if (!context || typeof context !== "object") {
    throw new Error("Frontend framework plugin returned no valid project context.");
  }
  if (context.pluginId !== expectedPluginId) {
    throw new Error(`Frontend framework context pluginId must be ${expectedPluginId}.`);
  }
  if (context.applicationRoot !== applicationRoot) {
    throw new Error(
      `Frontend framework context applicationRoot must match configured path ${applicationRoot}.`,
    );
  }
  if (!context.language || !context.runtime || !context.moduleSystem || !context.codeRoot) {
    throw new Error(
      "Frontend framework context must declare its language, runtime, module system, and code root.",
    );
  }
  normalizeVirtualPath(context.codeRoot);
  if (!context.scaffold || !context.scaffold.executable) {
    throw new Error("Frontend framework context must declare an upstream scaffold command.");
  }
  if (
    !Array.isArray(context.scaffold.argumentsBeforeTarget) ||
    !context.scaffold.argumentsBeforeTarget.every((argument) => typeof argument === "string") ||
    !Array.isArray(context.scaffold.argumentsAfterTarget) ||
    !context.scaffold.argumentsAfterTarget.every((argument) => typeof argument === "string")
  ) {
    throw new Error("Frontend framework scaffold arguments must be arrays of strings.");
  }
}

function selectedPlugins(
  frontend: FrontendDefinition,
  registry: FrontendPluginRegistry,
): { plugins: FrontendGeneratorPlugin[]; diagnostics: ConfigDiagnostic[] } {
  const selections = [
    { role: "framework" as const, pluginId: frameworkPluginId(frontend.framework) },
    { role: "styling" as const, pluginId: frontend.styling ?? "tailwind" },
    { role: "ui" as const, pluginId: frontend.ui ?? "native" },
  ];
  const diagnostics: ConfigDiagnostic[] = [];
  const plugins: FrontendGeneratorPlugin[] = [];

  for (const selection of selections) {
    const plugin = registry.get(selection.pluginId);
    if (!plugin) {
      diagnostics.push(
        createDiagnostic(
          "FRONTEND_PLUGIN_NOT_REGISTERED",
          `frontends.${frontend.name}.${selection.role}`,
          `Frontend plugin ${selection.pluginId} is not registered for the ${selection.role} role.`,
        ),
      );
      continue;
    }
    if (plugin.descriptor.role !== selection.role) {
      diagnostics.push(
        createDiagnostic(
          "FRONTEND_PLUGIN_ROLE_MISMATCH",
          `frontends.${frontend.name}.${selection.role}`,
          `Plugin ${plugin.descriptor.id} provides the ${plugin.descriptor.role} role, not ${selection.role}.`,
        ),
      );
      continue;
    }
    plugins.push(plugin);
  }

  const capabilities = new Set(plugins.flatMap((plugin) => plugin.descriptor.provides));
  for (const plugin of plugins) {
    for (const requirement of plugin.descriptor.requires ?? []) {
      if (capabilities.has(requirement.capability)) continue;
      diagnostics.push(
        createDiagnostic(
          "FRONTEND_PLUGIN_CAPABILITY_MISSING",
          `plugins.${plugin.descriptor.id}`,
          requirement.description ??
            `Frontend plugin ${plugin.descriptor.id} requires capability ${requirement.capability}.`,
        ),
      );
    }
  }
  return { plugins, diagnostics };
}

/** Composes one frontend without coupling its framework, styling, and UI plugins. */
export function composeFrontendPlugins(
  projectName: string,
  frontend: FrontendDefinition,
  registry: FrontendPluginRegistry,
): FrontendPluginCompositionResult {
  const { plugins, diagnostics } = selectedPlugins(frontend, registry);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return fail(diagnostics);

  const frameworkPlugin = plugins.find((plugin) => plugin.descriptor.role === "framework");
  if (!frameworkPlugin?.createFrameworkContext) {
    return fail([
      ...diagnostics,
      createDiagnostic(
        "FRONTEND_FRAMEWORK_CONTEXT_MISSING",
        `frontends.${frontend.name}.framework`,
        "The selected frontend framework plugin does not provide a framework context.",
      ),
    ]);
  }

  let frameworkContext: FrontendFrameworkContext;
  try {
    frameworkContext = frameworkPlugin.createFrameworkContext(frontend);
    validateFrameworkContext(frameworkContext, frameworkPlugin.descriptor.id, frontend.path);
  } catch (error) {
    return fail([
      ...diagnostics,
      createDiagnostic(
        "FRONTEND_FRAMEWORK_CONTEXT_INVALID",
        `plugins.${frameworkPlugin.descriptor.id}`,
        error instanceof Error ? error.message : "Frontend framework context is invalid.",
      ),
    ]);
  }

  const context = {
    projectName,
    frontend,
    framework: Object.freeze({
      ...frameworkContext,
      scaffold: Object.freeze({
        ...frameworkContext.scaffold,
        argumentsBeforeTarget: Object.freeze([...frameworkContext.scaffold.argumentsBeforeTarget]),
        argumentsAfterTarget: Object.freeze([...frameworkContext.scaffold.argumentsAfterTarget]),
      }),
      conventions: Object.freeze({ ...frameworkContext.conventions }),
    }),
    availableCapabilities: new Set(plugins.flatMap((plugin) => plugin.descriptor.provides)),
  };
  const stagedFiles = new Map<string, { content: string; pluginId: string }>();
  const runtimeDependencies: Record<string, string> = {};
  const developmentDependencies: Record<string, string> = {};

  for (const plugin of [...plugins].sort((left, right) =>
    left.descriptor.id.localeCompare(right.descriptor.id),
  )) {
    for (const [target, dependencies] of [
      [runtimeDependencies, plugin.descriptor.dependencies ?? {}],
      [developmentDependencies, plugin.descriptor.devDependencies ?? {}],
    ] as const) {
      for (const [dependency, version] of Object.entries(dependencies)) {
        const existingVersion = target[dependency];
        if (existingVersion && existingVersion !== version) {
          diagnostics.push(
            createDiagnostic(
              "FRONTEND_DEPENDENCY_VERSION_CONFLICT",
              `plugins.${plugin.descriptor.id}`,
              `Frontend plugins require conflicting versions of ${dependency}.`,
            ),
          );
        } else {
          target[dependency] = version;
        }
      }
    }

    let files: readonly GeneratedFile[];
    try {
      files = plugin.contribute(context);
      if (!Array.isArray(files)) throw new Error("contribute() must return an array of files.");
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          "FRONTEND_PLUGIN_CONTRIBUTION_FAILED",
          `plugins.${plugin.descriptor.id}`,
          error instanceof Error ? error.message : "Frontend plugin contribution failed.",
        ),
      );
      continue;
    }

    for (const file of files) {
      if (
        file === null ||
        typeof file !== "object" ||
        typeof file.path !== "string" ||
        typeof file.content !== "string"
      ) {
        diagnostics.push(
          createDiagnostic(
            "FRONTEND_PLUGIN_OUTPUT_INVALID",
            `plugins.${plugin.descriptor.id}`,
            "Frontend plugins must return files with string path and content values.",
          ),
        );
        continue;
      }
      let filePath: string;
      try {
        filePath = normalizeVirtualPath(file.path);
      } catch (error) {
        diagnostics.push(
          createDiagnostic(
            "FRONTEND_PLUGIN_PATH_INVALID",
            `plugins.${plugin.descriptor.id}`,
            String(error),
          ),
        );
        continue;
      }
      const applicationRoot = frontend.path === "." ? undefined : frontend.path;
      if (applicationRoot && !filePath.startsWith(`${applicationRoot}/`)) {
        diagnostics.push(
          createDiagnostic(
            "FRONTEND_PLUGIN_PATH_OUTSIDE_APPLICATION",
            filePath,
            `Frontend plugin ${plugin.descriptor.id} cannot write outside application ${frontend.name}.`,
          ),
        );
        continue;
      }
      const existing = stagedFiles.get(filePath);
      if (existing) {
        diagnostics.push(
          createDiagnostic(
            "FRONTEND_PLUGIN_PATH_COLLISION",
            filePath,
            `Frontend plugins ${existing.pluginId} and ${plugin.descriptor.id} both generated this path.`,
          ),
        );
        continue;
      }
      stagedFiles.set(filePath, { content: file.content, pluginId: plugin.descriptor.id });
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return fail(diagnostics);
  const virtualFileSystem = new VirtualFileSystem();
  for (const filePath of [...stagedFiles.keys()].sort((left, right) => left.localeCompare(right))) {
    virtualFileSystem.writeFile(
      filePath,
      (stagedFiles.get(filePath) as { content: string }).content,
    );
  }
  return {
    success: true,
    virtualFileSystem,
    frameworkContext: context.framework,
    runtimeDependencies: Object.freeze(runtimeDependencies),
    developmentDependencies: Object.freeze(developmentDependencies),
    diagnostics,
  };
}
