import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import type { NordixConfig } from "./schema.js";

/** Shared CLI preflight. Never run the old global-layer renderer as modular v2 output. */
export function generationReadiness(config: NordixConfig): ConfigDiagnostic[] {
  return config.backends.flatMap((backend, index) =>
    Object.entries(backend.modules).map(([name, module]) =>
      module.architecture === "clean"
        ? createDiagnostic(
            "MODULE_GENERATION_UNAVAILABLE",
            `backends[${index}].modules.${name}`,
            "YAML v2 configuration is valid, but modular generation is not integrated yet. Complete the resolved-model/direct-generation/Clean-module implementation before generating; no files or external commands have been started.",
          )
        : createDiagnostic(
            "MODULE_ARCHITECTURE_UNIMPLEMENTED",
            `backends[${index}].modules.${name}.architecture`,
            `Architecture '${module.architecture}' is recognized, but its generator is not implemented. Use an implemented family once modular generation is available; no fallback is performed.`,
          ),
    ),
  );
}
