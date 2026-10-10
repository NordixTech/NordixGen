import type { NordixConfig } from "../configuration/schema.js";
import { normalizeBackends } from "../configuration/schema.js";
import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import { buildBackendDomainModel } from "../intermediate-representation.js";
import { VirtualFileSystem, normalizeVirtualPath } from "../virtual-file-system.js";
import { ARCHITECTURE_FILE_ROLES } from "./contracts.js";
import type {
  ArchitectureLayout,
  FrameworkContext,
  GeneratedFile,
  GeneratorPlugin,
  PersistenceContext,
  PluginContributionContext,
  PluginRole,
  PluginSelection,
} from "./contracts.js";
import type { PluginRegistry } from "./registry.js";

export type PluginCompositionResult =
  | {
      success: true;
      virtualFileSystem: VirtualFileSystem;
      frameworkContext: FrameworkContext;
      architectureLayout: ArchitectureLayout;
      runtimeDependencies: Readonly<Record<string, string>>;
      diagnostics: ConfigDiagnostic[];
    }
  | { success: false; diagnostics: ConfigDiagnostic[] };

export interface ComposePluginsOptions {
  selections: readonly PluginSelection[];
  registry: PluginRegistry;
  requiredRoles?: readonly PluginRole[];
  externalCapabilities?: readonly string[];
  persistence?: Omit<PersistenceContext, "directories">;
  domainModel?: PluginContributionContext["domainModel"];
}

function fail(diagnostics: ConfigDiagnostic[]): PluginCompositionResult {
  return { success: false, diagnostics };
}

function validateRelativeDirectory(path: string, label: string, allowRoot = false): void {
  if (allowRoot && path === ".") return;
  if (normalizeVirtualPath(path) !== path) {
    throw new Error(`${label} must be a normalized, relative POSIX path; received "${path}".`);
  }
}

function validateFrameworkContext(context: FrameworkContext, expectedPluginId: string): void {
  if (typeof context !== "object") {
    throw new Error("Framework plugin returned no valid project context.");
  }
  if (context.pluginId !== expectedPluginId) {
    throw new Error(`Framework context pluginId must be "${expectedPluginId}".`);
  }
  if (!context.pluginId || !context.language || !context.runtime || !context.moduleSystem) {
    throw new Error(
      "Framework context must declare its plugin, language, runtime, and module system.",
    );
  }
  if (
    !context.scaffold ||
    typeof context.scaffold.executable !== "string" ||
    !context.scaffold.executable ||
    !Array.isArray(context.scaffold.argumentsBeforeTarget) ||
    !context.scaffold.argumentsBeforeTarget.every((argument) => typeof argument === "string") ||
    !Array.isArray(context.scaffold.argumentsAfterTarget) ||
    !context.scaffold.argumentsAfterTarget.every((argument) => typeof argument === "string")
  ) {
    throw new Error("Framework context must declare a valid upstream scaffold command.");
  }
  validateRelativeDirectory(context.applicationRoot, "Framework applicationRoot", true);
  validateRelativeDirectory(context.codeRoot, "Framework codeRoot");
  if (
    context.applicationRoot !== "." &&
    context.codeRoot !== context.applicationRoot &&
    !context.codeRoot.startsWith(`${context.applicationRoot}/`)
  ) {
    throw new Error(
      `Framework codeRoot "${context.codeRoot}" must be inside applicationRoot "${context.applicationRoot}".`,
    );
  }
  for (const [name, path] of Object.entries(context.entryPoints)) {
    if (!name || typeof path !== "string") {
      throw new Error("Framework entryPoints must map non-empty names to relative file paths.");
    }
    validateRelativeDirectory(path, `Framework entry point "${name}"`);
  }
  if (Object.values(context.conventions).some((value) => typeof value !== "string")) {
    throw new Error("Framework conventions must contain string values.");
  }
}

function validateArchitectureLayout(
  layout: ArchitectureLayout,
  expectedPluginId: string,
  expectedCodeRoot: string,
): void {
  if (typeof layout !== "object") {
    throw new Error("Architecture plugin returned no valid layout.");
  }
  if (layout.pluginId !== expectedPluginId) {
    throw new Error(`Architecture layout pluginId must be "${expectedPluginId}".`);
  }
  if (layout.codeRoot !== expectedCodeRoot) {
    throw new Error(
      `Architecture plugin "${expectedPluginId}" returned code root "${layout.codeRoot}", but framework code root is "${expectedCodeRoot}".`,
    );
  }
  const directories = layout.directories;
  if (!directories || typeof directories !== "object") {
    throw new Error("Architecture layout must define semantic role directories.");
  }
  for (const role of ARCHITECTURE_FILE_ROLES) {
    const path = directories[role];
    if (typeof path !== "string") {
      throw new Error(`Architecture layout is missing a directory for role "${role}".`);
    }
    validateRelativeDirectory(path, `Architecture directory for "${role}"`, true);
  }
  if (!Array.isArray(layout.dependencyRules)) {
    throw new Error("Architecture layout must define dependency rules as an array.");
  }
  for (const rule of layout.dependencyRules) {
    if (
      !rule ||
      !ARCHITECTURE_FILE_ROLES.includes(rule.from) ||
      !ARCHITECTURE_FILE_ROLES.includes(rule.to)
    ) {
      throw new Error("Architecture dependency rules must refer to known semantic file roles.");
    }
  }
}

function validateSelections(
  selections: readonly PluginSelection[],
  registry: PluginRegistry,
  requiredRoles: readonly PluginRole[],
  externalCapabilities: readonly string[],
): { plugins: GeneratorPlugin[]; diagnostics: ConfigDiagnostic[] } {
  const diagnostics: ConfigDiagnostic[] = [];
  const plugins: GeneratorPlugin[] = [];
  const selectedIds = new Set<string>();
  const selectedRoles = new Map<PluginRole, string>();

  for (const selection of selections) {
    if (selectedIds.has(selection.pluginId)) {
      diagnostics.push(
        createDiagnostic(
          "PLUGIN_SELECTED_MORE_THAN_ONCE",
          `plugins.${selection.pluginId}`,
          `Plugin "${selection.pluginId}" is selected more than once. Select it once and provide its configuration in that selection.`,
        ),
      );
      continue;
    }
    selectedIds.add(selection.pluginId);

    const plugin = registry.get(selection.pluginId);
    if (!plugin) {
      diagnostics.push(
        createDiagnostic(
          "PLUGIN_NOT_REGISTERED",
          `plugins.${selection.pluginId}`,
          `Plugin "${selection.pluginId}" is not registered. Install or register a plugin with that identifier.`,
        ),
      );
      continue;
    }

    const existingPluginId = selectedRoles.get(plugin.descriptor.role);
    if (existingPluginId) {
      diagnostics.push(
        createDiagnostic(
          "PLUGIN_ROLE_SELECTED_MORE_THAN_ONCE",
          `plugins.${selection.pluginId}`,
          `Plugins "${existingPluginId}" and "${selection.pluginId}" both provide the "${plugin.descriptor.role}" role. Select only one plugin for this role.`,
        ),
      );
      continue;
    }
    selectedRoles.set(plugin.descriptor.role, plugin.descriptor.id);
    plugins.push(plugin);
  }

  for (const role of requiredRoles) {
    if (!selectedRoles.has(role)) {
      diagnostics.push(
        createDiagnostic(
          "PLUGIN_ROLE_REQUIRED",
          `plugins.${role}`,
          `A plugin with the "${role}" role is required. Select and register one before generation.`,
        ),
      );
    }
  }

  const capabilities = new Set([
    ...plugins.flatMap((plugin) => plugin.descriptor.provides),
    ...externalCapabilities,
  ]);
  for (const plugin of plugins) {
    for (const requirement of plugin.descriptor.requires ?? []) {
      if (capabilities.has(requirement.capability)) continue;
      diagnostics.push(
        createDiagnostic(
          requirement.optional
            ? "PLUGIN_OPTIONAL_CAPABILITY_UNAVAILABLE"
            : "PLUGIN_CAPABILITY_MISSING",
          `plugins.${plugin.descriptor.id}`,
          requirement.description ??
            `Plugin "${plugin.descriptor.id}" ${requirement.optional ? "can use" : "requires"} capability "${requirement.capability}"${requirement.optional ? ", but it is not available in this composition" : "; select a compatible plugin that provides it"}.`,
          requirement.optional ? "warning" : "error",
        ),
      );
    }
  }

  return { plugins, diagnostics };
}

function invokeFrameworkPlugin(
  plugin: GeneratorPlugin,
  selection: PluginSelection,
): FrameworkContext {
  const context = plugin.createFrameworkContext?.(selection);
  if (!context)
    throw new Error(`Framework plugin "${plugin.descriptor.id}" returned no project context.`);
  validateFrameworkContext(context, plugin.descriptor.id);
  return Object.freeze({
    ...context,
    scaffold: Object.freeze({
      ...context.scaffold,
      argumentsBeforeTarget: Object.freeze([...context.scaffold.argumentsBeforeTarget]),
      argumentsAfterTarget: Object.freeze([...context.scaffold.argumentsAfterTarget]),
    }),
    entryPoints: Object.freeze({ ...context.entryPoints }),
    conventions: Object.freeze({ ...context.conventions }),
  });
}

function invokeArchitecturePlugin(
  plugin: GeneratorPlugin,
  framework: FrameworkContext,
  selection: PluginSelection,
): ArchitectureLayout {
  const layout = plugin.resolveArchitectureLayout?.(framework, selection);
  if (!layout) throw new Error(`Architecture plugin "${plugin.descriptor.id}" returned no layout.`);
  validateArchitectureLayout(layout, plugin.descriptor.id, framework.codeRoot);
  return Object.freeze({
    ...layout,
    directories: Object.freeze({ ...layout.directories }),
    dependencyRules: Object.freeze(
      layout.dependencyRules.map((rule) => Object.freeze({ ...rule })),
    ),
  });
}

export function composePlugins(options: ComposePluginsOptions): PluginCompositionResult {
  const { selections, registry } = options;
  const requiredRoles = [
    ...new Set<PluginRole>(["framework", "architecture", ...(options.requiredRoles ?? [])]),
  ];
  const selectionById = new Map(selections.map((selection) => [selection.pluginId, selection]));
  const { plugins, diagnostics } = validateSelections(
    selections,
    registry,
    requiredRoles,
    options.externalCapabilities ?? [],
  );
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return fail(diagnostics);

  const frameworkPlugin = plugins.find(
    (plugin) => plugin.descriptor.role === "framework",
  ) as GeneratorPlugin;
  const architecturePlugin = plugins.find(
    (plugin) => plugin.descriptor.role === "architecture",
  ) as GeneratorPlugin;

  let frameworkContext: FrameworkContext;
  let architectureLayout: ArchitectureLayout;
  try {
    frameworkContext = invokeFrameworkPlugin(
      frameworkPlugin,
      selectionById.get(frameworkPlugin.descriptor.id) as PluginSelection,
    );
    architectureLayout = invokeArchitecturePlugin(
      architecturePlugin,
      frameworkContext,
      selectionById.get(architecturePlugin.descriptor.id) as PluginSelection,
    );
  } catch (error) {
    diagnostics.push(
      createDiagnostic(
        "PLUGIN_CONTEXT_RESOLUTION_FAILED",
        "plugins",
        error instanceof Error ? error.message : "A plugin failed to resolve its project context.",
      ),
    );
    return fail(diagnostics);
  }

  const stagedFiles = new Map<string, { content: string; pluginId: string }>();
  const availableCapabilities = [
    ...plugins.flatMap((plugin) => plugin.descriptor.provides),
    ...(options.externalCapabilities ?? []),
  ];
  const orderedPlugins = [...plugins].sort((left, right) =>
    left.descriptor.role.localeCompare(right.descriptor.role),
  );
  const persistence: PersistenceContext | undefined = options.persistence
    ? Object.freeze({
        ...options.persistence,
        database: Object.freeze({ ...options.persistence.database }),
        directories: Object.freeze({
          infrastructure: normalizeVirtualPath(
            `${frameworkContext.codeRoot}/${architectureLayout.directories.infrastructure}`,
          ),
          adapter: normalizeVirtualPath(
            `${frameworkContext.codeRoot}/${architectureLayout.directories.adapter}`,
          ),
        }),
      })
    : undefined;

  for (const plugin of orderedPlugins) {
    const selection = selectionById.get(plugin.descriptor.id) as PluginSelection;
    const context: PluginContributionContext = {
      selection,
      framework: frameworkContext,
      architecture: architectureLayout,
      availableCapabilities: new Set(availableCapabilities),
      ...(options.domainModel ? { domainModel: options.domainModel } : {}),
      ...(persistence ? { persistence } : {}),
    };
    let files: readonly GeneratedFile[];
    try {
      files = plugin.contribute(context);
      if (!Array.isArray(files)) throw new Error("contribute() must return an array of files.");
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          "PLUGIN_CONTRIBUTION_FAILED",
          `plugins.${plugin.descriptor.id}`,
          error instanceof Error ? error.message : "Plugin contribution failed.",
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
            "PLUGIN_OUTPUT_FILE_INVALID",
            `plugins.${plugin.descriptor.id}`,
            `Plugin "${plugin.descriptor.id}" must return files with string path and content values.`,
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
            "PLUGIN_OUTPUT_PATH_INVALID",
            `plugins.${plugin.descriptor.id}`,
            error instanceof Error ? error.message : "Plugin returned an invalid output path.",
          ),
        );
        continue;
      }

      const existing = stagedFiles.get(filePath);
      if (existing) {
        diagnostics.push(
          createDiagnostic(
            "PLUGIN_OUTPUT_PATH_COLLISION",
            filePath,
            `Plugins "${existing.pluginId}" and "${plugin.descriptor.id}" both produced "${filePath}". Change one plugin's output path or explicitly define a merge strategy.`,
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
    frameworkContext,
    architectureLayout,
    runtimeDependencies: Object.assign(
      {},
      ...orderedPlugins.map((plugin) => plugin.descriptor.dependencies ?? {}),
    ),
    diagnostics,
  };
}

/** Resolves the plugin IDs and database capabilities declared by one backend's YAML config. */
export function composeBackendPlugins(
  config: NordixConfig,
  backendName: string,
  registry: PluginRegistry,
): PluginCompositionResult {
  const backend = normalizeBackends(config).find((candidate) => candidate.name === backendName);
  if (!backend) {
    return fail([
      createDiagnostic(
        "UNKNOWN_BACKEND_PLUGIN_TARGET",
        `backends.${backendName}`,
        `Backend "${backendName}" is not configured.`,
      ),
    ]);
  }

  const selections: PluginSelection[] = [
    { pluginId: backend.framework, configuration: { applicationRoot: backend.path } },
    { pluginId: backend.architecture },
  ];
  if (backend.authentication) {
    selections.push({
      pluginId: backend.authentication.plugin,
      configuration: {
        applicationRoot: backend.path,
        projectName: config.name,
        authentication: backend.authentication,
        authorization: backend.authorization,
      },
    });
  }
  const hasAuthorizationPolicies =
    backend.authorization.roles.length > 0 ||
    Object.values(backend.authorization.rolePermissions).some(
      (permissions) => permissions.length > 0,
    );
  if (hasAuthorizationPolicies) {
    selections.push({
      pluginId: backend.authorization.plugin,
      configuration: {
        applicationRoot: backend.path,
        authorization: backend.authorization,
      },
    });
  }
  const externalCapabilities: string[] = [];
  const domainModel = buildBackendDomainModel(config, backendName);
  let persistence: Omit<PersistenceContext, "directories"> | undefined;
  if (backend.persistence) {
    const database = config.databases[backend.persistence.database];
    if (!database) {
      return fail([
        createDiagnostic(
          "UNKNOWN_BACKEND_DATABASE",
          `backends.${backend.name}.persistence.database`,
          `Database "${backend.persistence.database}" is not configured under databases.`,
        ),
      ]);
    }
    selections.push({ pluginId: backend.persistence.orm });
    externalCapabilities.push(`database:${database.engine}`, `provider:${database.provider}`);
    persistence = {
      database: {
        name: backend.persistence.database,
        engine: database.engine,
        provider: database.provider,
      },
      connectionStringEnvironmentVariable: "DATABASE_URL",
    };
  }

  return composePlugins({ selections, registry, externalCapabilities, persistence, domainModel });
}
