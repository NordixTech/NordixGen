export type DiagnosticSeverity = "error" | "warning";

export interface ConfigDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  source?: { file?: string; line: number; column: number };
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
  const source = diagnostic.source
    ? ` (${diagnostic.source.file ? `${diagnostic.source.file}:` : "line "}${diagnostic.source.line}:${diagnostic.source.column})`
    : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}${source}: ${diagnostic.message}`;
}
