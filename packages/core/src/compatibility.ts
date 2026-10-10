import {
  type NordixConfig,
  normalizeBackends,
  normalizeFrontends,
} from "./configuration/schema.js";
import { type ConfigDiagnostic, createDiagnostic } from "./diagnostics.js";

export interface IncompatibilityRule {
  id: string;
  description: string;
}

export const INCOMPATIBILITY_MATRIX: readonly IncompatibilityRule[] = [
  {
    id: "frontend-backend-link",
    description: "Each frontend connection must name a configured backend.",
  },
  {
    id: "query-hook-strategy",
    description: "Generated query hooks require a supported server-state strategy.",
  },
  { id: "neon-postgres", description: "The Neon database provider requires PostgreSQL." },
  {
    id: "cloudflare-native-ci",
    description: "Cloudflare-native CI requires Cloudflare deployment.",
  },
  {
    id: "secured-endpoint-auth",
    description: "Secured endpoints require an authenticated backend.",
  },
];

export function validateCompatibility(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const backends = normalizeBackends(config);
  const backendByName = new Map(backends.map((backend) => [backend.name, backend]));

  for (const frontend of normalizeFrontends(config)) {
    for (const backendName of frontend.connectsTo) {
      if (backendByName.has(backendName)) continue;
      diagnostics.push(
        createDiagnostic(
          "INCOMPATIBLE_FRONTEND_BACKEND",
          `frontends.${frontend.name}.connectsTo`,
          `Backend "${backendName}" is not configured. Add it under backends or update this connection.`,
        ),
      );
    }

    if (
      typeof frontend.stateManagement === "object" &&
      frontend.stateManagement.generateHooks &&
      frontend.stateManagement.server === "native-fetch"
    ) {
      diagnostics.push(
        createDiagnostic(
          "INCOMPATIBLE_QUERY_HOOK_STRATEGY",
          `frontends.${frontend.name}.stateManagement`,
          "Generated query hooks need TanStack Query or SWR; native-fetch does not provide a query cache.",
        ),
      );
    }
  }

  for (const [name, database] of Object.entries(config.databases)) {
    if (database.provider === "neon" && database.engine !== "postgres") {
      diagnostics.push(
        createDiagnostic(
          "INCOMPATIBLE_NEON_DATABASE",
          `databases.${name}.engine`,
          "The Neon provider requires the postgres database engine.",
        ),
      );
    }
  }

  if (
    config.deployment?.ci === "cloudflare-native" &&
    config.deployment.provider !== "cloudflare"
  ) {
    diagnostics.push(
      createDiagnostic(
        "INCOMPATIBLE_CLOUDFLARE_CI",
        "deployment.ci",
        "cloudflare-native CI can only be used with the cloudflare deployment provider.",
      ),
    );
  }

  for (const [index, endpoint] of config.endpoints.entries()) {
    const backend = backendByName.get(endpoint.backend);
    const isSecured =
      endpoint.authRequired || endpoint.roles.length > 0 || endpoint.permissions.length > 0;
    if (isSecured && backend?.auth.type === "none" && !backend.authentication) {
      diagnostics.push(
        createDiagnostic(
          "INCOMPATIBLE_ENDPOINT_AUTH",
          `endpoints.${index}.authRequired`,
          `Endpoint ${endpoint.method} ${endpoint.path} requires authentication, but backend "${endpoint.backend}" uses auth type "none".`,
        ),
      );
    }
  }

  return diagnostics;
}
