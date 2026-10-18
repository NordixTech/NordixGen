import type { FieldDefinition, NordixConfig } from "../schema.js";

export function fieldDefinitions(
  config: NordixConfig,
  name: string,
): Record<string, FieldDefinition> {
  const entity = config.entities[name];
  if (!entity) return Object.create(null);
  const fields: Record<string, FieldDefinition> = Object.assign(Object.create(null), {
    ...entity.fields,
    id: { type: "uuid", required: true, unique: true },
  });
  if (entity.timestamps.createdAt)
    fields.createdAt = { type: "date", required: true, unique: false };
  if (entity.timestamps.updatedAt)
    fields.updatedAt = { type: "date", required: true, unique: false };
  if (entity.softDelete === "boolean")
    fields.isDeleted = { type: "boolean", required: true, unique: false, default: false };
  if (entity.softDelete === "timestamp")
    fields.deletedAt = { type: "date", required: false, unique: false };
  for (const relation of Object.values(entity.relations)) {
    if (relation.type === "many-to-one" || relation.type === "one-to-one")
      fields[relation.foreignKey ?? `${relation.target.toLowerCase()}_id`] ??= {
        type: "uuid",
        required: relation.required,
        unique: relation.type === "one-to-one",
      };
  }
  return fields;
}
export function moduleOwners(config: NordixConfig) {
  const owners = new Map<string, { backend: string; module: string }>();
  for (const backend of config.backends)
    for (const [module, definition] of Object.entries(backend.modules))
      for (const entity of definition.entities)
        if (!owners.has(entity)) owners.set(entity, { backend: backend.name, module });
  return owners;
}
export const snakeCase = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
export const entitySlug = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
export const reservedSymbol = (name: string) =>
  new Set(
    "await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof interface implements let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
      " ",
    ),
  ).has(name);
export function scopedOperationName(backend: string, id: string, qualify: boolean): string {
  return qualify
    ? backend
        .replace(/-+([a-z0-9])/g, (_all, letter: string) => letter.toUpperCase())
        .replace(/-+$/, "") +
        id.charAt(0).toUpperCase() +
        id.slice(1)
    : id;
}
export const sameOwner = (owners: ReturnType<typeof moduleOwners>, left: string, right: string) => {
  const a = owners.get(left);
  const b = owners.get(right);
  return !a || !b || (a.backend === b.backend && a.module === b.module);
};
export function portableSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !/[<>:"\\|?*]/.test(segment) &&
    ![...segment].some((character) => character.charCodeAt(0) < 32) &&
    !/[. ]$/.test(segment) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  );
}
export function safeRelativePath(path: string): boolean {
  return path === "." || path.split("/").every(portableSegment);
}
export function routePath(path: string, placeholders = false): boolean {
  return (
    path === "/" ||
    (path.startsWith("/") &&
      path
        .slice(1)
        .split("/")
        .every(
          (segment) =>
            segment !== "." &&
            segment !== ".." &&
            (/^[A-Za-z0-9._~-]+$/.test(segment) ||
              (placeholders && /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment))),
        ))
  );
}
