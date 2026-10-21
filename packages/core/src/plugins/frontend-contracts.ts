import type { ResolvedFrontend, ResolvedIdentity, TransportOperation } from "../project/types.js";
import type { UpstreamScaffoldPlan } from "./contracts.js";
export type FrontendApiEntity = ResolvedFrontend["entities"][string];
export type FrontendAuthenticationContract = ResolvedIdentity;
export interface FrontendApiContract {
  readonly endpoints: readonly TransportOperation[];
  readonly operationNames: ResolvedFrontend["operationNames"];
  readonly features: ResolvedFrontend["features"];
  readonly entities: ResolvedFrontend["entities"];
  readonly enums: Readonly<Record<string, readonly string[]>>;
  readonly authentication?: ResolvedIdentity;
}
export interface FrontendPaths {
  readonly applicationRoot: string;
  readonly codeRoot: string;
  readonly scaffold: UpstreamScaffoldPlan;
}
export interface FrontendRenderContext {
  readonly projectName: string;
  readonly frontend: ResolvedFrontend;
  readonly framework: FrontendPaths;
  readonly api: FrontendApiContract;
}
