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
    engine: "NordixGen Deterministic Intermediate Representation Engine",
  };
}

export * from "./compatibility.js";
export * from "./diagnostics.js";
export * from "./intermediate-representation.js";
export * from "./json-schema.js";
export * from "./plugins/composer.js";
export * from "./plugins/contracts.js";
export * from "./plugins/registry.js";
export * from "./plugins/architecture/clean.js";
export * from "./plugins/architecture/domain-files.js";
export * from "./plugins/frameworks/hono.js";
export * from "./plugins/orms/drizzle.js";
export * from "./configuration/schema.js";
export * from "./configuration/validate.js";
export * from "./virtual-file-system.js";
