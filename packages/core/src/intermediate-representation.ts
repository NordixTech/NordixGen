import {
  type EntityDefinition,
  type FieldDefinition,
  type NordixConfig,
  type RelationDefinition,
  normalizeBackends,
  normalizeFrontends,
} from "./configuration/schema.js";
import { validateNordixConfig } from "./configuration/validate.js";
import { type ConfigDiagnostic, createDiagnostic, formatDiagnostic } from "./diagnostics.js";

export interface NordixEntityRepresentation {
  name: string;
  backend: string;
  description?: string;
  fields: Record<string, FieldDefinition>;
  relations: Record<string, RelationDefinition>;
  timestamps: EntityDefinition["timestamps"];
  softDelete: boolean;
}

export interface NordixDependencyEdge {
  dependency: string;
  dependent: string;
  relation: string;
}

export interface NordixIntermediateRepresentation {
  formatVersion: 3;
  project: { name: string; version: string; description?: string };
  organizations: NordixConfig["organizations"];
  repositories: NordixConfig["repositories"];
  frontends: ReturnType<typeof normalizeFrontends>;
  backends: ReturnType<typeof normalizeBackends>;
  databases: NordixConfig["databases"];
  docker?: NordixConfig["docker"];
  llm?: NordixConfig["llm"];
  deployment?: NordixConfig["deployment"];
  enums: Record<string, string[]>;
  entities: Record<string, NordixEntityRepresentation>;
  dependencyEdges: NordixDependencyEdge[];
  entityOrder: string[];
  endpoints: NordixConfig["endpoints"];
}

export class NordixConfigError extends Error {
  readonly diagnostics: ConfigDiagnostic[];

  constructor(diagnostics: ConfigDiagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join("\n"));
    this.name = "NordixConfigError";
    this.diagnostics = diagnostics;
  }
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function canonicalField(field: FieldDefinition): FieldDefinition {
  if (field.default === undefined) return { ...field } as FieldDefinition;
  return { ...field, default: canonicalValue(field.default) } as FieldDefinition;
}

function canonicalEntity(name: string, entity: EntityDefinition): NordixEntityRepresentation {
  const fields = sortedRecord(entity.fields);
  const normalizedFields: Record<string, FieldDefinition> = {
    id: { type: "uuid", required: true, unique: true },
  };
  for (const [fieldName, field] of Object.entries(fields)) {
    if (fieldName !== "id") normalizedFields[fieldName] = canonicalField(field);
  }
  if (entity.timestamps.createdAt) {
    normalizedFields.createdAt = { type: "date", required: true, unique: false };
  }
  if (entity.timestamps.updatedAt) {
    normalizedFields.updatedAt = { type: "date", required: true, unique: false };
  }
  if (entity.softDelete)
    normalizedFields.deletedAt = { type: "date", required: false, unique: false };

  return {
    name,
    backend: entity.backend,
    ...(entity.description === undefined ? {} : { description: entity.description }),
    fields: sortedRecord(normalizedFields),
    relations: sortedRecord(entity.relations),
    timestamps: entity.timestamps,
    softDelete: entity.softDelete,
  };
}

/** Creates the deterministic domain input for one backend without validating unrelated config. */
export function buildBackendDomainModel(
  config: NordixConfig,
  backendName: string,
): Pick<NordixIntermediateRepresentation, "enums" | "entities" | "endpoints"> {
  const entities = Object.fromEntries(
    Object.entries(config.entities)
      .filter(([, entity]) => entity.backend === backendName)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entity]) => [name, canonicalEntity(name, entity)]),
  );
  return {
    enums: sortedRecord(config.enums),
    entities,
    endpoints: config.endpoints
      .filter((endpoint) => endpoint.backend === backendName)
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
      ),
  };
}

function relationEdgeOrder(entities: Record<string, EntityDefinition>): NordixDependencyEdge[] {
  const edges: NordixDependencyEdge[] = [];
  for (const [sourceName, entity] of Object.entries(entities)) {
    for (const [relationName, relation] of Object.entries(entity.relations)) {
      if (relation.type === "many-to-many") continue;
      const dependency = relation.type === "one-to-many" ? sourceName : relation.target;
      const dependent = relation.type === "one-to-many" ? relation.target : sourceName;
      edges.push({ dependency, dependent, relation: `${sourceName}.${relationName}` });
    }
  }
  return edges.sort(
    (left, right) =>
      left.dependency.localeCompare(right.dependency) ||
      left.dependent.localeCompare(right.dependent) ||
      left.relation.localeCompare(right.relation),
  );
}

export function sortEntitiesTopologically(entities: Record<string, EntityDefinition>): string[] {
  const names = Object.keys(entities).sort((left, right) => left.localeCompare(right));
  const nameSet = new Set(names);
  const edges = relationEdgeOrder(entities);
  const dependents = new Map(names.map((name) => [name, new Set<string>()]));
  const inDegree = new Map(names.map((name) => [name, 0]));

  for (const edge of edges) {
    if (!nameSet.has(edge.dependency) || !nameSet.has(edge.dependent)) {
      const missing = !nameSet.has(edge.dependency) ? edge.dependency : edge.dependent;
      throw new NordixConfigError([
        createDiagnostic(
          "UNKNOWN_GRAPH_NODE",
          edge.relation,
          `Relation graph refers to unknown entity "${missing}".`,
        ),
      ]);
    }
    const children = dependents.get(edge.dependency) as Set<string>;
    if (!children.has(edge.dependent)) {
      children.add(edge.dependent);
      inDegree.set(edge.dependent, (inDegree.get(edge.dependent) as number) + 1);
    }
  }

  const ready = names.filter((name) => inDegree.get(name) === 0);
  const ordered: string[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => left.localeCompare(right));
    const current = ready.shift() as string;
    ordered.push(current);
    for (const dependent of [...(dependents.get(current) as Set<string>)].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const nextDegree = (inDegree.get(dependent) as number) - 1;
      inDegree.set(dependent, nextDegree);
      if (nextDegree === 0) ready.push(dependent);
    }
  }

  if (ordered.length !== names.length) {
    const cycleEntities = names.filter((name) => !ordered.includes(name));
    throw new NordixConfigError([
      createDiagnostic(
        "RELATION_CYCLE",
        "entities",
        `Foreign-key dependency cycle detected among: ${cycleEntities.join(", ")}. Break the cycle or make one relation many-to-many.`,
      ),
    ]);
  }
  return ordered;
}

export function buildIntermediateRepresentation(input: unknown): NordixIntermediateRepresentation {
  const validation = validateNordixConfig(input);
  if (!validation.success) throw new NordixConfigError(validation.diagnostics);
  const config = validation.config;
  const entityEntries = Object.entries(config.entities).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const entities = Object.fromEntries(
    entityEntries.map(([name, entity]) => [name, canonicalEntity(name, entity)]),
  );
  const edges = relationEdgeOrder(config.entities);

  return {
    formatVersion: 3,
    project: {
      name: config.name,
      version: config.version,
      ...(config.description === undefined ? {} : { description: config.description }),
    },
    organizations: [...config.organizations].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    repositories: [...config.repositories].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    frontends: normalizeFrontends(config),
    backends: normalizeBackends(config),
    databases: sortedRecord(config.databases),
    ...(config.docker === undefined ? {} : { docker: config.docker }),
    ...(config.llm === undefined ? {} : { llm: config.llm }),
    ...(config.deployment === undefined ? {} : { deployment: config.deployment }),
    enums: sortedRecord(config.enums),
    entities,
    dependencyEdges: edges,
    entityOrder: sortEntitiesTopologically(config.entities),
    endpoints: [...config.endpoints].sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
    ),
  };
}

export function serializeIntermediateRepresentation(
  representation: NordixIntermediateRepresentation,
): string {
  return `${JSON.stringify(representation, null, 2)}\n`;
}
