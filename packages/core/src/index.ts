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
    engine: "NordixGen Deterministic IR & AST Engine",
  };
}
