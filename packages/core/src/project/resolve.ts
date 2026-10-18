import { resolveGenerationReadiness } from "../configuration/readiness.js";
import { effectiveAuthorization } from "../configuration/schema.js";
import {
  type ConfigValidationResult,
  parseNordixYaml,
  validateNordixConfig,
} from "../configuration/validate.js";
import { snakeCase } from "../configuration/validation/shared.js";
import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import { canonicalValue, resolveEntities, sortedRecord } from "./fields.js";
import { resolveFrontend } from "./frontends.js";
import { dependencyOrder } from "./graphs.js";
import { compareHttpOperations, resolveOperation } from "./operations.js";
import type {
  ConfigurationOrigin,
  ResolvedBackend,
  ResolvedDatabase,
  ResolvedModule,
  ResolvedProject,
} from "./types.js";

export type ProjectResolutionResult =
  | {
      readonly success: true;
      readonly project: ResolvedProject;
      readonly diagnostics: readonly ConfigDiagnostic[];
    }
  | { readonly success: false; readonly diagnostics: readonly ConfigDiagnostic[] };
export interface ResolutionOptions {
  readonly requireGeneration?: boolean;
}
function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}
function resolveValidated(
  validation: ConfigValidationResult,
  options?: ResolutionOptions,
): ProjectResolutionResult {
  if (!validation.success) return validation;
  const config = validation.config;
  const origin = (path: string): ConfigurationOrigin => ({
    path,
    ...(validation.locate ? { source: validation.locate(path) } : {}),
  });
  const owners = new Map<string, string>();
  const moduleOrigins = new Map<string, ConfigurationOrigin>();
  for (const [index, backend] of config.backends.entries())
    for (const [name, module] of Object.entries(backend.modules)) {
      const id = `${backend.name}.${name}`;
      moduleOrigins.set(id, origin(`backends[${index}].modules.${name}`));
      for (const name of module.entities) owners.set(name, id);
    }
  const entities = resolveEntities(config, owners, origin);
  const databases = sortedRecord<ResolvedDatabase>(
    Object.keys(config.databases).map((name) => [
      name,
      { name, engine: "postgres", provider: "neon" },
    ]),
  );
  const backends = sortedRecord<ResolvedBackend>(
    config.backends.map((backend, index) => {
      const policy = effectiveAuthorization(backend);
      return [
        backend.name,
        {
          name: backend.name,
          repository: config.repositories.find(
            (r) => r.name === backend.repository,
          ) as (typeof config.repositories)[number],
          path: backend.path,
          ...(backend.persistence ? { database: databases[backend.persistence.database] } : {}),
          ...(backend.authentication
            ? {
                identity: {
                  backend: backend.name,
                  ...backend.authentication,
                  roles: policy.roles,
                  defaultRole: policy.defaultRole as string,
                  rolePermissions: sortedRecord(Object.entries(policy.rolePermissions)),
                },
              }
            : {}),
          modules: Object.keys(backend.modules)
            .map((name) => `${backend.name}.${name}`)
            .sort(),
          moduleOrder: [],
          entityOrder: [],
          operations: [],
          origin: origin(`backends[${index}]`),
        },
      ];
    }),
  );
  const operationList = config.endpoints
    .map((endpoint, index) =>
      resolveOperation(endpoint, index, config, entities, backends[endpoint.backend], origin),
    )
    .sort(compareHttpOperations);
  const operations = sortedRecord(operationList.map((operation) => [operation.id, operation]));
  const modules = sortedRecord<ResolvedModule>(
    config.backends.flatMap((backend) =>
      Object.entries(backend.modules).map(([name, module]) => {
        const id = `${backend.name}.${name}`;
        return [
          id,
          {
            id,
            name,
            backend: backend.name,
            architecture: module.architecture,
            entities: [...module.entities].sort(),
            operations: operationList
              .filter((operation) => operation.moduleId === id)
              .map((operation) => operation.id)
              .sort(),
            exports: module.exports.map((operation) => `${id}.${operation}`).sort(),
            imports: Object.entries(module.imports)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([producer, imported]) => ({
                moduleId: `${backend.name}.${producer}`,
                operations: imported
                  .map((operation) => `${backend.name}.${producer}.${operation}`)
                  .sort(),
              })),
            dependencies: Object.keys(module.imports)
              .map((name) => `${backend.name}.${name}`)
              .sort(),
            origin: moduleOrigins.get(id) as ConfigurationOrigin,
            architectureOrigin: origin(`${moduleOrigins.get(id)?.path}.architecture`),
          },
        ] as const;
      }),
    ),
  );
  const moduleOrder = dependencyOrder(
    Object.keys(modules),
    new Map(Object.values(modules).map((module) => [module.id, module.dependencies])),
  ).order;
  const entityDependencies = Object.values(entities)
    .flatMap((entity) =>
      Object.values(entity.relations)
        .filter((r) => r.type === "many-to-one" || r.type === "one-to-one")
        .map((relation) => ({
          dependency: relation.target,
          dependent: entity.name,
          relation: `${entity.name}.${relation.name}`,
        })),
    )
    .sort(
      (a, b) =>
        a.dependency.localeCompare(b.dependency) ||
        a.dependent.localeCompare(b.dependent) ||
        a.relation.localeCompare(b.relation),
    );
  const entityGraph = dependencyOrder(
    Object.keys(entities),
    new Map(
      Object.keys(entities).map((name) => [
        name,
        entityDependencies.filter((edge) => edge.dependent === name).map((edge) => edge.dependency),
      ]),
    ),
  );
  if (entityGraph.cycle.length) {
    const edge = entityDependencies.find(
      (e) => e.dependent === entityGraph.cycle[0] && e.dependency === entityGraph.cycle[1],
    ) as (typeof entityDependencies)[number];
    const at = origin(`entities.${edge.relation.replace(".", ".relations.")}.target`);
    return {
      success: false,
      diagnostics: [
        {
          ...createDiagnostic(
            "RELATION_CYCLE",
            at.path,
            `Stored foreign-key cycle: ${entityGraph.cycle.join(" -> ")}. Break the stored dependency, for example with a scalar identifier and an explicit application call; no seed/migration fallback is generated.`,
          ),
          ...(at.source ? { source: at.source } : {}),
        },
      ],
    };
  }
  const resolvedBackends = sortedRecord(
    Object.entries(backends).map(([name, backend]) => [
      name,
      {
        ...backend,
        moduleOrder: moduleOrder.filter((id) => modules[id].backend === name),
        entityOrder: entityGraph.order.filter((id) => entities[id].backend === name),
        operations: operationList
          .filter((operation) => operation.backend === name)
          .map((operation) => operation.id),
      },
    ]),
  );
  const frontends = sortedRecord(
    config.frontends.map((frontend, index) => [
      frontend.name,
      resolveFrontend(
        frontend,
        config,
        resolvedBackends,
        entities,
        operationList,
        origin(`frontends[${index}]`),
      ),
    ]),
  );
  const project: ResolvedProject = freeze({
    formatVersion: 5,
    project: {
      name: config.name,
      version: config.version,
      ...(config.description === undefined ? {} : { description: config.description }),
    },
    organizations: [...config.organizations].sort((a, b) => a.name.localeCompare(b.name)),
    repositories: [...config.repositories].sort((a, b) => a.name.localeCompare(b.name)),
    databases,
    enums: sortedRecord(Object.entries(config.enums)),
    enumSqlNames: sortedRecord(
      Object.keys(config.enums).map((name) => [name, `${snakeCase(name)}_enum`]),
    ),
    backends: resolvedBackends,
    modules,
    entities,
    operations,
    frontends,
    moduleOrder,
    entityOrder: entityGraph.order,
    entityDependencies,
    readiness: resolveGenerationReadiness(Object.values(modules), entities),
  });
  return options?.requireGeneration && project.readiness.length
    ? { success: false, diagnostics: project.readiness }
    : { success: true, project, diagnostics: [] };
}
export function resolveProject(
  input: unknown,
  options?: ResolutionOptions,
): ProjectResolutionResult {
  return resolveValidated(validateNordixConfig(input), options);
}
export function resolveProjectYaml(
  source: string,
  file?: string,
  options?: ResolutionOptions,
): ProjectResolutionResult {
  return resolveValidated(parseNordixYaml(source, file), options);
}
export function serializeResolvedProject(project: ResolvedProject): string {
  return `${JSON.stringify(canonicalValue(project), null, 2)}\n`;
}
