export type DiagnosticSeverity = "error" | "warning";

export interface ConfigDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
}

export function createDiagnostic(
  code: string,
  path: string,
  message: string,
  severity: DiagnosticSeverity = "error",
): ConfigDiagnostic {
  return { code, severity, path, message };
}

export function formatDiagnostic(diagnostic: ConfigDiagnostic): string {
  const location = diagnostic.path.length > 0 ? ` at ${diagnostic.path}` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}: ${diagnostic.message}`;
}
