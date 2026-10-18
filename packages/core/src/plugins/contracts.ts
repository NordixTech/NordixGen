import type { BackendModelView, ResolvedIdentity } from "../project/types.js";

export interface GeneratedFile {
  path: string;
  content: string;
}
export interface UpstreamScaffoldPlan {
  readonly executable: string;
  readonly argumentsBeforeTarget: readonly string[];
  readonly argumentsAfterTarget: readonly string[];
}
export type ArchitectureFileRole =
  | "domainEntity"
  | "useCase"
  | "inboundPort"
  | "outboundPort"
  | "adapter"
  | "controller"
  | "infrastructure";
export interface BackendPaths {
  readonly applicationRoot: string;
  readonly codeRoot: string;
  readonly entryPoints: { readonly worker: string };
  readonly scaffold: UpstreamScaffoldPlan;
}
export interface CleanLayout {
  readonly codeRoot: string;
  readonly directories: Readonly<Record<ArchitectureFileRole, string>>;
}
export type DomainModelContext = BackendModelView;
export interface PersistenceContext {
  readonly database: {
    readonly name: string;
    readonly engine: "postgres";
    readonly provider: "neon";
  };
  readonly directories: {
    readonly infrastructure: string;
    readonly adapter: string;
    readonly schema: string;
  };
  readonly connectionStringEnvironmentVariable: "DATABASE_URL";
}
export interface BackendRenderContext {
  readonly framework: BackendPaths;
  readonly architecture: CleanLayout;
  readonly domainModel: BackendModelView;
  readonly persistence?: PersistenceContext;
  readonly identity?: ResolvedIdentity;
  readonly projectName: string;
  readonly platformRoot: string;
  readonly moduleRoots: Readonly<Record<string, string>>;
  readonly moduleId?: string;
  readonly sharedDatabaseFile?: string;
}
