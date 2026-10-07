import { parseDocument } from "yaml";
import type { z } from "zod";
import { validateCompatibility } from "../compatibility.js";
import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import { type NordixConfig, NordixConfigSchema } from "./schema.js";
import { validateApplications } from "./validation/applications.js";
import { validateEndpoints } from "./validation/endpoints.js";
import { validateEntities } from "./validation/entities.js";
import { validatePersistence } from "./validation/persistence.js";

export type ConfigValidationResult =
  | { success: true; config: NordixConfig; diagnostics: ConfigDiagnostic[] }
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
  const diagnostics = [
    ...validateEntities(config),
    ...validateApplications(config),
    ...validateEndpoints(config),
    ...validatePersistence(config),
    ...validateCompatibility(config),
  ];
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { success: false, diagnostics };
  }
  return { success: true, config, diagnostics };
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
