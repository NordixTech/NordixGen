import type { FrontendDefinition } from "../configuration/schema.js";
import type { GeneratedFile, UpstreamScaffoldPlan } from "./contracts.js";

export const FRONTEND_PLUGIN_ROLES = ["framework", "styling", "ui"] as const;

export type FrontendPluginRole = (typeof FRONTEND_PLUGIN_ROLES)[number];

export interface FrontendPluginCapabilityRequirement {
  readonly capability: string;
  readonly description?: string;
}

export interface FrontendPluginDescriptor {
  readonly id: string;
  readonly version: string;
  readonly role: FrontendPluginRole;
  readonly provides: readonly string[];
  readonly requires?: readonly FrontendPluginCapabilityRequirement[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/** Project conventions exposed by the selected frontend framework plugin. */
export interface FrontendFrameworkContext {
  readonly pluginId: string;
  readonly applicationRoot: string;
  readonly codeRoot: string;
  readonly language: string;
  readonly runtime: string;
  readonly moduleSystem: string;
  readonly scaffold: UpstreamScaffoldPlan;
  readonly conventions: Readonly<Record<string, string>>;
}

export interface FrontendPluginContributionContext {
  readonly projectName: string;
  readonly frontend: FrontendDefinition;
  readonly framework: FrontendFrameworkContext;
  readonly availableCapabilities: ReadonlySet<string>;
}

export interface FrontendGeneratorPlugin {
  readonly descriptor: FrontendPluginDescriptor;
  createFrameworkContext?: (frontend: FrontendDefinition) => FrontendFrameworkContext;
  contribute: (context: FrontendPluginContributionContext) => readonly GeneratedFile[];
}
