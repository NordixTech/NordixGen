import { createDiagnostic } from "../diagnostics.js";
import type { ResolvedEntity, ResolvedModule, ResolvedProject } from "../project/types.js";

/** Concrete internal implementation status; no configurable capability registry. */
export const MODULE_GENERATION_SUPPORT = {
  clean: "pending-integration",
  hexagonal: "not-implemented",
  onion: "not-implemented",
} as const;
export function resolveGenerationReadiness(
  modules: readonly ResolvedModule[],
  entities: Readonly<Record<string, ResolvedEntity>>,
) {
  return [
    ...modules
      .filter(
        (module) =>
          module.architecture !== "clean" ||
          modules.filter((other) => other.backend === module.backend).length > 1,
      )
      .map((module) => ({
        ...createDiagnostic(
          MODULE_GENERATION_SUPPORT[module.architecture] === "pending-integration"
            ? "MODULE_GENERATION_UNAVAILABLE"
            : "MODULE_ARCHITECTURE_UNIMPLEMENTED",
          MODULE_GENERATION_SUPPORT[module.architecture] === "pending-integration"
            ? module.origin.path
            : `${module.origin.path}.architecture`,
          MODULE_GENERATION_SUPPORT[module.architecture] === "pending-integration"
            ? "Multiple Clean modules require the modular composition integration. Use a single Clean module until that integration is available; no files or external commands have been started."
            : `Architecture '${module.architecture}' is recognized, but its generator is not implemented. Select an implemented family once modular integration is available; no fallback is performed.`,
        ),
        ...((module.architecture === "clean" ? module.origin : module.architectureOrigin).source
          ? {
              source: (module.architecture === "clean" ? module.origin : module.architectureOrigin)
                .source,
            }
          : {}),
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
