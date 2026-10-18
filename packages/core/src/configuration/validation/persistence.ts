import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";

export function validatePersistence(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const databaseNames = new Set(Object.keys(config.databases));

  for (const [index, backend] of config.backends.entries()) {
    if (backend.authentication && !backend.persistence)
      diagnostics.push(
        createDiagnostic(
          "AUTHENTICATION_PERSISTENCE_REQUIRED",
          `backends[${index}].persistence`,
          "Better Auth requires persistence. Declare one named database and select it here.",
        ),
      );
    const persistence = backend.persistence;
    if (!persistence || databaseNames.has(persistence.database)) continue;

    diagnostics.push(
      createDiagnostic(
        "UNKNOWN_BACKEND_DATABASE",
        `backends[${index}].persistence.database`,
        `Database "${persistence.database}" is not configured under databases. Add the named database or update this reference.`,
      ),
    );
  }

  return diagnostics;
}
