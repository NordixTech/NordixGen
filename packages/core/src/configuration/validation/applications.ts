import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";
import { normalizeBackends, normalizeFrontends } from "../schema.js";

export function validateApplications(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  const applications = [
    ...normalizeFrontends(config).map((application) => ({ ...application, kind: "frontend" })),
    ...normalizeBackends(config).map((application) => ({ ...application, kind: "backend" })),
  ];

  for (const application of applications) {
    const namePath = `${application.kind}s.${application.name}.name`;
    const pathPath = `${application.kind}s.${application.name}.path`;
    if (seenNames.has(application.name)) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_APP_NAME",
          namePath,
          `Application name "${application.name}" is used more than once.`,
        ),
      );
    }
    seenNames.add(application.name);

    const normalizedPath = application.path.replace(/\/+$/g, "");
    if (normalizedPath.startsWith("/") || normalizedPath.split("/").includes("..")) {
      diagnostics.push(
        createDiagnostic(
          "UNSAFE_APP_PATH",
          pathPath,
          "Application paths must be relative and cannot traverse above the project root.",
        ),
      );
    }
    if (seenPaths.has(normalizedPath)) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_APP_PATH",
          pathPath,
          `Application path "${normalizedPath}" is already assigned to another application.`,
        ),
      );
    }
    seenPaths.add(normalizedPath);
  }

  return diagnostics;
}
