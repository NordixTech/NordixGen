import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";
import { moduleOwners, portableSegment } from "./shared.js";

export function validateModules(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const add = (code: string, path: string, message: string) =>
    diagnostics.push(createDiagnostic(code, path, message));
  const owners = moduleOwners(config);
  const assigned = new Map<string, string>();
  for (const [bi, backend] of config.backends.entries()) {
    const graph = new Map<string, string[]>();
    const operations = new Map(
      config.endpoints.filter((e) => e.backend === backend.name).map((e) => [e.operationId, e]),
    );
    for (const [name, module] of Object.entries(backend.modules)) {
      const path = `backends[${bi}].modules.${name}`;
      if (!portableSegment(name))
        add(
          "PATH_UNSAFE",
          path,
          "Choose a module name that is not a reserved filesystem device name.",
        );
      graph.set(name, []);
      for (const [ei, entityName] of module.entities.entries()) {
        const entity = config.entities[entityName];
        if (!entity)
          add(
            "UNKNOWN_MODULE_ENTITY",
            `${path}.entities[${ei}]`,
            `Entity "${entityName}" does not exist. Declare it under entities or correct the module list.`,
          );
        else if (entity.backend !== backend.name)
          add(
            "ENTITY_OWNER_BACKEND_MISMATCH",
            `${path}.entities[${ei}]`,
            `Entity "${entityName}" belongs to backend "${entity.backend}". Assign it to a module of that backend.`,
          );
        if (assigned.has(entityName))
          add(
            "ENTITY_OWNER_DUPLICATE",
            `${path}.entities[${ei}]`,
            `Entity "${entityName}" is already assigned to "${assigned.get(entityName)}" and cannot also belong to "${backend.name}.${name}". Assign exactly one owner.`,
          );
        assigned.set(entityName, `${backend.name}.${name}`);
      }
      for (const [ei, operation] of module.exports.entries()) {
        const endpoint = operations.get(operation);
        if (!endpoint)
          add(
            "MODULE_EXPORT_UNKNOWN",
            `${path}.exports[${ei}]`,
            `Operation "${operation}" does not exist in backend "${backend.name}". Export an existing owned operationId.`,
          );
        else if (owners.get(endpoint.entity)?.module !== name)
          add(
            "MODULE_EXPORT_OWNER_MISMATCH",
            `${path}.exports[${ei}]`,
            `Operation "${operation}" belongs to another module. Export only operations owned by "${name}".`,
          );
      }
      for (const [producer, imports] of Object.entries(module.imports)) {
        const producerModule = backend.modules[producer];
        if (!producerModule) {
          add(
            "MODULE_IMPORT_UNKNOWN",
            `${path}.imports.${producer}`,
            `Module "${producer}" does not exist in backend "${backend.name}". Select an existing producer module.`,
          );
          continue;
        }
        if (producer === name)
          add(
            "MODULE_IMPORT_SELF",
            `${path}.imports.${producer}`,
            `Module "${name}" cannot import itself. Use its private application implementation directly.`,
          );
        else graph.get(name)?.push(producer);
        for (const [ii, operation] of imports.entries()) {
          const endpoint = operations.get(operation);
          if (!endpoint)
            add(
              "MODULE_IMPORT_UNKNOWN",
              `${path}.imports.${producer}[${ii}]`,
              `Operation "${operation}" does not exist in this backend. Import an exported producer operation.`,
            );
          else if (
            !producerModule.exports.includes(operation) ||
            owners.get(endpoint.entity)?.module !== producer
          )
            add(
              "MODULE_IMPORT_NOT_EXPORTED",
              `${path}.imports.${producer}[${ii}]`,
              `Module "${name}" imports "${operation}" from "${producer}", but that producer does not export the owned operation. Correct the import or export an existing producer operation.`,
            );
        }
      }
    }
    const complete = new Set<string>();
    const visit = (name: string, chain: string[]): boolean => {
      const at = chain.indexOf(name);
      if (at >= 0) {
        add(
          "MODULE_DEPENDENCY_CYCLE",
          `backends[${bi}].modules`,
          `Synchronous module cycle: ${[...chain.slice(at), name].join(" -> ")}. Remove an import or move the coordinating application logic.`,
        );
        return true;
      }
      if (complete.has(name)) return false;
      for (const dependency of graph.get(name) ?? [])
        if (visit(dependency, [...chain, name])) return true;
      complete.add(name);
      return false;
    };
    for (const name of [...graph.keys()].sort()) if (visit(name, [])) break;
  }
  for (const [name, entity] of Object.entries(config.entities)) {
    if (!config.backends.some((b) => b.name === entity.backend))
      add(
        "UNKNOWN_ENTITY_BACKEND",
        `entities.${name}.backend`,
        `Backend "${entity.backend}" does not exist. Declare it or correct this reference.`,
      );
    else if (!assigned.has(name))
      add(
        "ENTITY_OWNER_MISSING",
        `entities.${name}`,
        `Entity "${name}" has no module owner. Include it in exactly one entities list of backend "${entity.backend}".`,
      );
  }
  return diagnostics;
}
