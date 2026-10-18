import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";
import { portableSegment, reservedSymbol, safeRelativePath, snakeCase } from "./shared.js";

export function validateApplications(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const add = (code: string, path: string, message: string) =>
    diagnostics.push(createDiagnostic(code, path, message));
  for (const [collection, items] of [
    ["organizations", config.organizations],
    ["repositories", config.repositories],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.name))
        add(
          "DUPLICATE_NAME",
          `${collection}[${index}].name`,
          `Name "${item.name}" is already declared in ${collection}. Choose a unique name.`,
        );
      seen.add(item.name);
    }
  }
  const repositoryPaths = new Map<string, string>();
  for (const [index, repository] of config.repositories.entries()) {
    const path = `repositories[${index}]`;
    if (!safeRelativePath(repository.path))
      add(
        "PATH_UNSAFE",
        `${path}.path`,
        "Use a portable relative POSIX path without traversal, empty segments, device names or trailing separators.",
      );
    const normalized = repository.path.toLowerCase();
    for (const [previous, name] of repositoryPaths)
      if (
        previous === normalized ||
        previous === "." ||
        normalized === "." ||
        previous.startsWith(`${normalized}/`) ||
        normalized.startsWith(`${previous}/`)
      )
        add(
          "REPOSITORY_PATH_OVERLAP",
          `${path}.path`,
          `Repository path overlaps "${name}". Use separate non-nested directories or one shared repository.`,
        );
    repositoryPaths.set(normalized, repository.name);
    if (repository.createRemote && !repository.organization)
      add(
        "REMOTE_REPOSITORY_WITHOUT_ORGANIZATION",
        `${path}.organization`,
        "Remote creation requires an existing organization alias. Declare it or disable createRemote.",
      );
    if (repository.createRemote && !repository.initializeGit)
      add(
        "REMOTE_REQUIRES_LOCAL_GIT",
        `${path}.initializeGit`,
        "Remote publication requires an initialized local repository. Enable initializeGit or disable createRemote.",
      );
    if (
      repository.organization &&
      !config.organizations.some((o) => o.name === repository.organization)
    )
      add(
        "UNKNOWN_REPOSITORY_ORGANIZATION",
        `${path}.organization`,
        `Organization "${repository.organization}" does not exist. Declare it under organizations or correct this reference.`,
      );
  }
  const seenApps = new Set<string>();
  const appPaths = new Map<string, string>();
  for (const [collection, apps] of [
    ["backends", config.backends],
    ["frontends", config.frontends],
  ] as const)
    for (const [index, app] of apps.entries()) {
      const path = `${collection}[${index}]`;
      if (seenApps.has(app.name))
        add(
          "DUPLICATE_APP_NAME",
          `${path}.name`,
          `Application "${app.name}" is already declared. Frontend and backend names must be unique across the project.`,
        );
      seenApps.add(app.name);
      if (!config.repositories.some((r) => r.name === app.repository))
        add(
          "UNKNOWN_APP_REPOSITORY",
          `${path}.repository`,
          `Repository "${app.repository}" does not exist. Declare it or correct this reference.`,
        );
      if (!safeRelativePath(app.path))
        add(
          "PATH_UNSAFE",
          `${path}.path`,
          "Use a portable relative application path contained in its repository.",
        );
      const key = `${app.repository}/${app.path}`.toLowerCase();
      for (const [previous, name] of appPaths) {
        const root = `${app.repository}/.`.toLowerCase();
        if (
          key === previous ||
          (previous.startsWith(`${app.repository.toLowerCase()}/`) &&
            (key === root ||
              previous === root ||
              key.startsWith(`${previous}/`) ||
              previous.startsWith(`${key}/`)))
        )
          add(
            "APP_PATH_OVERLAP",
            `${path}.path`,
            `Application path overlaps "${name}". Assign distinct non-nested paths within the repository.`,
          );
      }
      appPaths.set(key, app.name);
    }
  const names = new Map<string, string>();
  const enumNames = new Map<string, string>();
  for (const name of Object.keys(config.enums)) {
    const previous = enumNames.get(snakeCase(name));
    if (previous || config.entities[name])
      add(
        "GENERATED_NAME_COLLISION",
        `enums.${name}`,
        `Enum "${name}" conflicts with ${previous ? `enum "${previous}"` : `entity "${name}"`}. Rename it and update its references.`,
      );
    enumNames.set(snakeCase(name), name);
    if (reservedSymbol(name))
      add(
        "GENERATED_NAME_COLLISION",
        `enums.${name}`,
        "This enum name is a reserved TypeScript symbol. Rename the enum and its references.",
      );
  }
  for (const [name, entity] of Object.entries(config.entities)) {
    const normalized = `${entity.backend}:${snakeCase(name).replaceAll("_", "")}`;
    const previous = names.get(normalized);
    if (previous)
      add(
        "GENERATED_NAME_COLLISION",
        `entities.${name}`,
        `Entity "${name}" collides with "${previous}" after generated-name normalization. Rename one entity.`,
      );
    names.set(normalized, name);
    if (reservedSymbol(name))
      add(
        "GENERATED_NAME_COLLISION",
        `entities.${name}`,
        "This entity name is a reserved TypeScript symbol. Rename the entity and its references.",
      );
    if (!portableSegment(name))
      add(
        "PATH_UNSAFE",
        `entities.${name}`,
        "Choose an entity name that is not a reserved filesystem device name.",
      );
    const backend = config.backends.find((b) => b.name === entity.backend);
    if (
      backend?.authentication &&
      [
        "user",
        "authuser",
        "authroles",
        "authrolepermissions",
        "authiamaudit",
        "session",
        "account",
        "verification",
        "twofactor",
      ].includes(snakeCase(name).replaceAll("_", ""))
    )
      add(
        "GENERATED_NAME_COLLISION",
        `entities.${name}`,
        `Entity "${name}" conflicts with a platform-owned authentication table. Rename this business entity.`,
      );
  }
  return diagnostics;
}
