import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";
import { normalizeBackends, normalizeFrontends } from "../schema.js";

export function validateApplications(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const organizations = new Set<string>();
  for (const [index, organization] of config.organizations.entries()) {
    if (organizations.has(organization.name)) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_ORGANIZATION",
          `organizations.${index}.name`,
          `Organization "${organization.name}" is declared more than once.`,
        ),
      );
    }
    organizations.add(organization.name);
  }

  const repositories = new Map<string, (typeof config.repositories)[number]>();
  const repositoryPaths = new Map<string, string>();
  for (const [index, repository] of config.repositories.entries()) {
    const normalizedPath = normalizePath(repository.path);
    if (repositories.has(repository.name)) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_REPOSITORY",
          `repositories.${index}.name`,
          `Repository "${repository.name}" is declared more than once.`,
        ),
      );
    }
    repositories.set(repository.name, repository);
    validateSafePath(repository.path, `repositories.${index}.path`, diagnostics, "REPOSITORY");
    const previousPath = repositoryPaths.get(normalizedPath);
    if (previousPath) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_REPOSITORY_PATH",
          `repositories.${index}.path`,
          `Repository path "${normalizedPath}" is already assigned to "${previousPath}".`,
        ),
      );
    }
    for (const [existingPath, existingName] of repositoryPaths) {
      if (
        existingPath !== normalizedPath &&
        (isWithinRepository(existingPath, normalizedPath) ||
          isWithinRepository(normalizedPath, existingPath))
      ) {
        diagnostics.push(
          createDiagnostic(
            "NESTED_REPOSITORY_PATH",
            `repositories.${index}.path`,
            `Repository "${repository.name}" is nested with repository "${existingName}". Place Git repositories in separate directories or configure one shared repository.`,
          ),
        );
      }
    }
    repositoryPaths.set(normalizedPath, repository.name);
    if (repository.createRemote && !repository.organization) {
      diagnostics.push(
        createDiagnostic(
          "REMOTE_REPOSITORY_WITHOUT_ORGANIZATION",
          `repositories.${index}.organization`,
          "Creating a remote repository requires an organization entry.",
        ),
      );
    }
    if (repository.organization && !organizations.has(repository.organization)) {
      diagnostics.push(
        createDiagnostic(
          "UNKNOWN_REPOSITORY_ORGANIZATION",
          `repositories.${index}.organization`,
          `Organization "${repository.organization}" is not configured under organizations.`,
        ),
      );
    }
  }

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

    const repository = repositories.get(application.repository);
    if (!repository) {
      diagnostics.push(
        createDiagnostic(
          "UNKNOWN_APP_REPOSITORY",
          `${application.kind}s.${application.name}.repository`,
          `Repository "${application.repository}" is not configured.`,
        ),
      );
    }
    validateSafePath(application.path, pathPath, diagnostics, "APP");
    const normalizedPath = `${application.repository}/${normalizePath(application.path)}`;
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

function normalizePath(value: string): string {
  return value.replace(/\/+$/g, "").replace(/^\.\/$/, ".");
}

function isWithinRepository(parent: string, child: string): boolean {
  if (parent === ".") return true;
  return child.startsWith(`${parent}/`);
}

function validateSafePath(
  value: string,
  path: string,
  diagnostics: ConfigDiagnostic[],
  kind: "APP" | "REPOSITORY",
): void {
  const normalized = normalizePath(value);
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    diagnostics.push(
      createDiagnostic(
        `UNSAFE_${kind}_PATH`,
        path,
        "Paths must be relative and cannot traverse above their repository or project root.",
      ),
    );
  }
}
