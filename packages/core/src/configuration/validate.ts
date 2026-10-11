import { parseDocument } from "yaml";
import type { z } from "zod";
import { validateCompatibility } from "../compatibility.js";
import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import { type NordixConfig, NordixConfigSchema, type NormalizedNordixConfig } from "./schema.js";
import { validateApplications } from "./validation/applications.js";
import { validateEndpoints } from "./validation/endpoints.js";
import { validateEntities } from "./validation/entities.js";
import { validatePersistence } from "./validation/persistence.js";

export type ConfigValidationResult =
  | {
      success: true;
      config: NordixConfig;
      normalizedConfig: NormalizedNordixConfig;
      diagnostics: ConfigDiagnostic[];
    }
  | { success: false; diagnostics: ConfigDiagnostic[] };

function zodDiagnostics(error: z.ZodError): ConfigDiagnostic[] {
  return error.issues.map((issue) =>
    createDiagnostic("CONFIG_SCHEMA_INVALID", issue.path.map(String).join("."), issue.message),
  );
}

export function validateNordixConfig(input: unknown): ConfigValidationResult {
  const parsed = NordixConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, diagnostics: zodDiagnostics(parsed.error) };
  }

  const config = parsed.data;
  const diagnostics = validatePaginationProfiles(config);
  const normalizedDiagnostics = [
    ...diagnostics,
    ...validateEndpoints(config),
    ...validateEntities(config),
    ...validateApplications(config),
    ...validatePersistence(config),
    ...validateCompatibility(config),
  ];
  if (normalizedDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { success: false, diagnostics: normalizedDiagnostics };
  }
  return {
    success: true,
    config,
    normalizedConfig: normalizePaginationConfig(config),
    diagnostics: normalizedDiagnostics,
  };
}

function validatePaginationProfiles(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  for (const [index, endpoint] of config.endpoints.entries()) {
    if (endpoint.pagination && !config.pagination[endpoint.pagination]) {
      diagnostics.push(
        createDiagnostic(
          "UNKNOWN_PAGINATION_PROFILE",
          `endpoints.${index}.pagination`,
          `Pagination profile "${endpoint.pagination}" is not defined under pagination.`,
        ),
      );
    }
  }
  for (const [index, endpoint] of config.endpoints.entries()) {
    if (!endpoint.pagination || !config.pagination[endpoint.pagination]) continue;
    const profile = config.pagination[endpoint.pagination];
    const queryNames = new Set(endpoint.queryParams.map(({ name }) => name));
    if (queryNames.has(profile.pageParam) || queryNames.has(profile.pageSizeParam)) {
      diagnostics.push(
        createDiagnostic(
          "PAGINATION_PARAMETER_CONFLICT",
          `endpoints.${index}.pagination`,
          "Pagination query parameter names must not collide with declared query parameters.",
        ),
      );
    }
    if (endpoint.method !== "GET" || endpoint.pathParams.length > 0) {
      diagnostics.push(
        createDiagnostic(
          "PAGINATION_REQUIRES_GET",
          `endpoints.${index}.pagination`,
          "Pagination is only supported on GET collection endpoints without path parameters.",
        ),
      );
    }
  }
  return diagnostics;
}

export function resolvePaginationProfileReferences(config: NordixConfig): NormalizedNordixConfig {
  const endpoints = config.endpoints.map((endpoint) => {
    if (!endpoint.pagination) return endpoint;
    const profile = config.pagination[endpoint.pagination];
    if (!profile) return endpoint;
    const { pagination: _profileReference, ...endpointConfig } = endpoint;
    return { ...endpointConfig, pagination: profile };
  });
  return { ...config, endpoints } as NormalizedNordixConfig;
}

export function normalizePaginationConfig(config: NordixConfig): NormalizedNordixConfig {
  return resolvePaginationProfileReferences(config);
}

export function parseNordixYaml(source: string): ConfigValidationResult {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      success: false,
      diagnostics: document.errors.map((error) => {
        const position = error.linePos ? error.linePos[0] : undefined;
        const location = position ? `line ${position.line}, column ${position.col}` : "";
        return createDiagnostic("YAML_SYNTAX_ERROR", location, error.message);
      }),
    };
  }

  let value: unknown;
  try {
    value = document.toJS();
  } catch (error) {
    return {
      success: false,
      diagnostics: [
        createDiagnostic(
          "YAML_CONVERSION_ERROR",
          "",
          error instanceof Error
            ? error.message
            : "YAML could not be converted to a data structure.",
        ),
      ],
    };
  }
  return validateNordixConfig(value);
}
