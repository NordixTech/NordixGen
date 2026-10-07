export const PLUGIN_ROLES = ["architecture", "framework", "orm", "authentication"] as const;

export type PluginRole = (typeof PLUGIN_ROLES)[number];

export const ARCHITECTURE_FILE_ROLES = [
  "domainEntity",
  "useCase",
  "inboundPort",
  "outboundPort",
  "adapter",
  "controller",
  "infrastructure",
] as const;

export type ArchitectureFileRole = (typeof ARCHITECTURE_FILE_ROLES)[number];

export interface PluginCapabilityRequirement {
  readonly capability: string;
  readonly optional?: boolean;
  readonly description?: string;
}

export interface PluginDescriptor {
  readonly id: string;
  readonly version: string;
  readonly role: PluginRole;
  readonly provides: readonly string[];
  readonly requires?: readonly PluginCapabilityRequirement[];
}

/** Project conventions exposed by a framework plugin to all other backend plugins. */
export interface FrameworkContext {
  readonly pluginId: string;
  readonly applicationRoot: string;
  readonly codeRoot: string;
  readonly language: string;
  readonly runtime: string;
  readonly moduleSystem: string;
  readonly entryPoints: Readonly<Record<string, string>>;
  readonly conventions: Readonly<Record<string, string>>;
}

/** Framework-independent semantic locations, relative to the framework's code root. */
export interface ArchitectureLayout {
  readonly pluginId: string;
  readonly codeRoot: string;
  directories: Readonly<Record<ArchitectureFileRole, string>>;
  dependencyRules: readonly {
    readonly from: ArchitectureFileRole;
    readonly to: ArchitectureFileRole;
  }[];
}

export interface PluginSelection {
  pluginId: string;
  configuration?: unknown;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface PluginContributionContext {
  selection: PluginSelection;
  framework: FrameworkContext;
  architecture: ArchitectureLayout;
  availableCapabilities: ReadonlySet<string>;
}

export interface GeneratorPlugin {
  descriptor: PluginDescriptor;
  createFrameworkContext?: (selection: PluginSelection) => FrameworkContext;
  resolveArchitectureLayout?: (
    framework: FrameworkContext,
    selection: PluginSelection,
  ) => ArchitectureLayout;
  contribute: (context: PluginContributionContext) => readonly GeneratedFile[];
}
