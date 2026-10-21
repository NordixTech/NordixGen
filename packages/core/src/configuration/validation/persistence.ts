import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";

export function validatePersistence(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const databaseNames = new Set(Object.keys(config.databases));
  const assignments = new Map<string, { name: string; index: number }[]>();

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
    if (!persistence) continue;
    if (databaseNames.has(persistence.database)) {
      const owners = assignments.get(persistence.database) ?? [];
      owners.push({ name: backend.name, index });
      assignments.set(persistence.database, owners);
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        "UNKNOWN_BACKEND_DATABASE",
        `backends[${index}].persistence.database`,
        `Database "${persistence.database}" is not configured under databases. Add the named database or update this reference.`,
      ),
    );
  }

  for (const [database, owners] of assignments) {
    if (owners.length < 2) continue;
    for (const owner of owners)
      diagnostics.push(
        createDiagnostic(
          "DATABASE_SHARED_ACROSS_BACKENDS",
          `backends[${owner.index}].persistence.database`,
          `Database "${database}" cannot be shared across multiple backends (${owners.map(({ name }) => `"${name}"`).join(", ")}). Each backend requires an independent, dedicated database resource. Merge the business modules into a single modular monolith backend, or declare a distinct resource under databases for each backend.`,
        ),
      );
  }

  return diagnostics;
}
