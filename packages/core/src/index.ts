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

export * from "./configuration/readiness.js";
export * from "./diagnostics.js";
export * from "./project/types.js";
export * from "./project/resolve.js";
export * from "./project/views.js";
export * from "./json-schema.js";
export * from "./generation/backend.js";
export * from "./generation/frontend.js";
export * from "./generation/files.js";
export * from "./generation/dependencies.js";
export * from "./plugins/contracts.js";
export * from "./plugins/frontend-contracts.js";
export * from "./plugins/frontend-api-contract.js";
export * from "./plugins/frontend-composer.js";
export * from "./plugins/frontend-registry.js";

export * from "./plugins/architecture/clean.js";
export * from "./plugins/architecture/domain-files.js";
export * from "./plugins/architecture/application-files.js";
export * from "./plugins/authentication/better-auth.js";
export * from "./plugins/authorization/rbac-pbac.js";
export * from "./plugins/frameworks/hono.js";
export * from "./plugins/frameworks/hono-files.js";
export * from "./plugins/frontends/better-auth-client.js";
export * from "./plugins/frontends/feature-screens.js";
export * from "./plugins/frontends/client-state.js";
export * from "./plugins/frontends/native-ui.js";
export * from "./plugins/frontends/nextjs.js";
export * from "./plugins/frontends/root-shell.js";
export * from "./plugins/frontends/server-state.js";
export * from "./plugins/frontends/typed-api-client.js";
export * from "./plugins/orms/drizzle.js";
export * from "./plugins/orms/drizzle-files.js";
export * from "./plugins/styling/plain-css.js";
export * from "./plugins/styling/tailwind.js";
export * from "./configuration/schema.js";
export * from "./configuration/validate.js";
export * from "./virtual-file-system.js";
