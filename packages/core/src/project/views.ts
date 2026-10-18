import { createDiagnostic, formatDiagnostic } from "../diagnostics.js";
import type { ConfigDiagnostic } from "../diagnostics.js";
import { dictionary } from "./fields.js";
import type {
  BackendModelView,
  ModuleModelView,
  ResolvedFrontend,
  ResolvedProject,
} from "./types.js";

export class ProjectModelError extends Error {
  constructor(readonly diagnostics: readonly ConfigDiagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join("\n"));
    this.name = "ProjectModelError";
  }
}
export function backendView(project: ResolvedProject, name: string): BackendModelView {
  const backend = project.backends[name];
  if (!backend)
    throw new ProjectModelError([
      createDiagnostic(
        "UNKNOWN_BACKEND_TARGET",
        "backends",
        `Backend "${name}" does not exist in this resolved project. Select a declared backend.`,
      ),
    ]);
  return Object.freeze({
    backend,
    enums: project.enums,
    enumSqlNames: project.enumSqlNames,
    entities: Object.freeze(
      dictionary(backend.entityOrder.map((name) => [name, project.entities[name]])),
    ),
    endpoints: Object.freeze(backend.operations.map((id) => project.operations[id])),
    entityOrder: backend.entityOrder,
    modules: Object.freeze(backend.moduleOrder.map((id) => project.modules[id])),
  });
}
export function moduleView(project: ResolvedProject, id: string): ModuleModelView {
  const module = project.modules[id];
  if (!module)
    throw new ProjectModelError([
      createDiagnostic(
        "UNKNOWN_MODULE_TARGET",
        "backends",
        `Module "${id}" does not exist in this resolved project. Select a backend-qualified module ID.`,
      ),
    ]);
  return Object.freeze({
    module,
    entities: Object.freeze(module.entities.map((name) => project.entities[name])),
    operations: Object.freeze(module.operations.map((id) => project.operations[id])),
    exports: Object.freeze(module.exports.map((id) => project.operations[id].application)),
    imports: Object.freeze(
      module.imports.map((dependency) =>
        Object.freeze({
          moduleId: dependency.moduleId,
          operations: Object.freeze(
            dependency.operations.map((id) => project.operations[id].application),
          ),
        }),
      ),
    ),
  });
}
export function frontendView(project: ResolvedProject, name: string): ResolvedFrontend {
  const frontend = project.frontends[name];
  if (!frontend)
    throw new ProjectModelError([
      createDiagnostic(
        "UNKNOWN_FRONTEND_TARGET",
        "frontends",
        `Frontend "${name}" does not exist in this resolved project. Select a declared frontend.`,
      ),
    ]);
  return frontend;
}
