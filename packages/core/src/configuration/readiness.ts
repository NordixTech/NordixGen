import { createDiagnostic } from "../diagnostics.js";
import type { ResolvedEntity, ResolvedModule, ResolvedProject } from "../project/types.js";

/** Concrete internal implementation status; no configurable capability registry. */
export const MODULE_GENERATION_SUPPORT = {
  clean: "implemented",
  hexagonal: "not-implemented",
  onion: "not-implemented",
} as const;
export function resolveGenerationReadiness(
  modules: readonly ResolvedModule[],
  entities: Readonly<Record<string, ResolvedEntity>>,
) {
  return [
    ...modules
      .filter((module) => module.architecture !== "clean")
      .map((module) => ({
        ...createDiagnostic(
          "MODULE_ARCHITECTURE_UNIMPLEMENTED",
          `${module.origin.path}.architecture`,
          `Architecture '${module.architecture}' is recognized, but its generator is not implemented. Select Clean; no fallback or files are emitted.`,
        ),
        ...(module.architectureOrigin.source ? { source: module.architectureOrigin.source } : {}),
      })),
    ...modules
      .filter((module) => module.exports.length > 0 || module.imports.length > 0)
      .map((module) => ({
        ...createDiagnostic(
          "MODULE_COMMUNICATION_UNAVAILABLE",
          module.origin.path,
          "Public module contracts and dependency wiring are not integrated yet. Generate independent Clean modules without exports/imports until that integration is available; no files or commands were emitted.",
        ),
        ...(module.origin.source ? { source: module.origin.source } : {}),
      })),
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
