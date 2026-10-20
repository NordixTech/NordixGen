/**
 * @nordixgen/core
 * Declarative Architecture & Scaffolding Engine Core
 */

export const CORE_VERSION = "0.1.0";

export interface NordixCoreInfo {
  version: string;
  engine: string;
}

export function getCoreInfo(): NordixCoreInfo {
  return {
    version: CORE_VERSION,
    engine: "NordixGen Resolved Project Engine",
  };
}

// Supported configuration, resolved-model and generation entry points.
export { generationReadiness } from "./configuration/readiness.js";
export type { ConfigDiagnostic, DiagnosticSeverity } from "./diagnostics.js";
export { formatDiagnostic } from "./diagnostics.js";
export * from "./project/types.js";
export * from "./project/resolve.js";
export * from "./project/views.js";
export { createNordixJsonSchema } from "./json-schema.js";
export { generateBackend } from "./generation/backend.js";
export { generateFrontend, FRONTEND_SCAFFOLD_OVERLAYS } from "./generation/frontend.js";
export { collectFiles, BACKEND_SCAFFOLD_OVERLAYS } from "./generation/files.js";
export { WORKSPACE_TOOLING } from "./generation/dependencies.js";
export type { GeneratedFile, UpstreamScaffoldPlan } from "./plugins/contracts.js";
export { NordixConfigSchema } from "./configuration/schema.js";
export type { NordixConfig } from "./configuration/schema.js";
export type { ConfigValidationResult } from "./configuration/validate.js";
export {
  parseNordixYaml,
  validateNordixConfig,
  stringifyNordixYaml,
} from "./configuration/validate.js";
export * from "./virtual-file-system.js";
export { cloudflareWorkerName, r2BucketName } from "./generation/cloudflare.js";
