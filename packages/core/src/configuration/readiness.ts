import { createDiagnostic } from "../diagnostics.js";
import type { ResolvedEntity, ResolvedModule, ResolvedProject } from "../project/types.js";

export function resolveGenerationReadiness(
  _modules: readonly ResolvedModule[],
  entities: Readonly<Record<string, ResolvedEntity>>,
) {
  return [
    ...Object.values(entities).flatMap((entity) =>
      Object.values(entity.relations)
        .filter((relation) => relation.type === "many-to-many")
        .map((relation) => ({
          ...createDiagnostic(
            "RELATION_MAPPING_UNIMPLEMENTED",
            relation.origin.path,
            "Many-to-many relations are recognized, but join-table generation is not implemented. Use an explicit association entity with owning to-one relations, or wait for the actual join-table implementation; no partial table is emitted.",
          ),
          ...(relation.origin.source ? { source: relation.origin.source } : {}),
        })),
    ),
  ];
}
/** Reading readiness never parses, validates or resolves configuration again. */
export function generationReadiness(project: ResolvedProject) {
  return project.readiness;
}
