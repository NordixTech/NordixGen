import type { FrontendDefinition } from "../configuration/schema.js";
import type { ResolvedFrontend, TransportOperation } from "../project/types.js";
import type { GeneratedFile, UpstreamScaffoldPlan } from "./contracts.js";

export const FRONTEND_PLUGIN_ROLES = [
  "framework",
  "styling",
  "ui",
  "api-client",
  "server-state",
  "client-state",
  "authentication",
  "feature-screens",
] as const;

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
  readonly frontend: FrontendRenderSettings;
  readonly framework: FrontendFrameworkContext;
  readonly availableCapabilities: ReadonlySet<string>;
  readonly api: FrontendApiContract;
}

export type FrontendApiEntity = ResolvedFrontend["entities"][string];

export interface FrontendAuthenticationContract {
  readonly plugin: string;
  readonly backend: string;
  readonly methods: readonly string[];
  readonly identityProviders: readonly string[];
  readonly features: readonly string[];
  readonly roles: readonly string[];
  readonly defaultRole?: string;
  readonly rolePermissions: Readonly<Record<string, readonly string[]>>;
}

export interface FrontendApiContract {
  readonly endpoints: readonly TransportOperation[];
  readonly operationNames: Readonly<Record<string, string>>;
  readonly features: ResolvedFrontend["features"];
  readonly entities: Readonly<Record<string, FrontendApiEntity>>;
  readonly enums: Readonly<Record<string, readonly string[]>>;
  readonly authentication?: FrontendAuthenticationContract;
}

export interface FrontendGeneratorPlugin {
  readonly descriptor: FrontendPluginDescriptor;
  createFrameworkContext?: (frontend: FrontendRenderSettings) => FrontendFrameworkContext;
  contribute: (context: FrontendPluginContributionContext) => readonly GeneratedFile[];
}

// Temporary concrete renderer settings. RF-08 removes these composition options;
// the resolved project model contains none of these configurable library selectors.
export type FrontendRenderSettings = FrontendDefinition & {
  framework: string;
  type: "web";
  styling: string;
  ui: string;
  authUI: boolean;
  stateManagement?: {
    client: "zustand" | "context" | "none";
    server: "tanstack-query" | "swr" | "native-fetch";
    generateHooks: boolean;
    optimisticUpdates: boolean;
  };
};
