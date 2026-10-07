import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import { type NordixConfig, normalizeBackends } from "../schema.js";

export function validatePersistence(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const databaseNames = new Set(Object.keys(config.databases));

  for (const backend of normalizeBackends(config)) {
    const persistence = backend.persistence;
    if (!persistence || databaseNames.has(persistence.database)) continue;

    diagnostics.push(
      createDiagnostic(
        "UNKNOWN_BACKEND_DATABASE",
        `backends.${backend.name}.persistence.database`,
        `Database "${persistence.database}" is not configured under databases. Add the named database or update this reference.`,
      ),
    );
  }

  return diagnostics;
}
