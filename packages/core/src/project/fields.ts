import type { FieldDefinition, NordixConfig } from "../configuration/schema.js";
import { fieldDefinitions, snakeCase } from "../configuration/validation/shared.js";
import type {
  ConfigurationOrigin,
  JsonValue,
  ResolvedEntity,
  ResolvedField,
  ResolvedValue,
} from "./types.js";

export function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return dictionary([...entries].sort(([a], [b]) => a.localeCompare(b)));
}
export function dictionary<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.assign(Object.create(null), Object.fromEntries(entries));
}
export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object")
    return sortedRecord(Object.entries(value).map(([key, child]) => [key, canonicalValue(child)]));
  return value;
}
export function resolveValue(field: FieldDefinition, enums: NordixConfig["enums"]): ResolvedValue {
  const type =
    field.type === "enum"
      ? enums[field.enumName].map((value) => JSON.stringify(value)).join(" | ")
      : field.type === "string" || field.type === "uuid"
        ? "string"
        : field.type === "json"
          ? "unknown"
          : field.type === "date"
            ? "Date"
            : field.type;
  return {
    kind: field.type,
    applicationType: type,
    transportType: field.type === "date" ? "string" : type,
    ...(field.type === "enum" ? { enumValues: enums[field.enumName] } : {}),
    serialization:
      field.type === "date" ? "utc-iso-instant" : field.type === "json" ? "json" : "identity",
  };
}
export function resolveField(
  name: string,
  field: FieldDefinition,
  enums: NordixConfig["enums"],
  origin: ConfigurationOrigin,
  generated: ResolvedField["generated"] = false,
): ResolvedField {
  const clock =
    field.type === "date" &&
    typeof field.default === "object" &&
    field.default !== null &&
    "kind" in field.default;
  const defaultValue =
    field.default === undefined
      ? undefined
      : field.type === "date" && typeof field.default === "string"
        ? new Date(field.default).toISOString()
        : canonicalValue(field.default);
  return {
    ...field,
    ...(field.type === "number"
      ? {
          format:
            field.format ??
            (field.precision !== undefined || field.scale !== undefined
              ? ("decimal" as const)
              : ("float" as const)),
          ...(field.format === "decimal" ||
          field.precision !== undefined ||
          field.scale !== undefined
            ? { precision: field.precision ?? 10, scale: field.scale ?? 2 }
            : {}),
        }
      : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    name,
    column: snakeCase(name),
    origin,
    generated,
    nullable: !field.required,
    value: resolveValue(field, enums),
    defaultValue: clock
      ? { kind: "clock" }
      : defaultValue === undefined
        ? { kind: "absent" }
        : { kind: "literal", value: defaultValue as JsonValue },
    writable: !generated,
    createOptional: Boolean(generated) || !field.required || field.default !== undefined,
  };
}
export function resolveEntities(
  config: NordixConfig,
  owner: ReadonlyMap<string, string>,
  origin: (path: string) => ConfigurationOrigin,
): Record<string, ResolvedEntity> {
  return sortedRecord(
    Object.entries(config.entities).map(([name, entity]) => {
      const moduleId = owner.get(name) as string;
      const id = `${moduleId}.${name}`;
      const generated: Record<string, ResolvedField["generated"]> = dictionary([
        ["id", "identity"],
      ]);
      if (entity.timestamps.createdAt) generated.createdAt = "created-at";
      if (entity.timestamps.updatedAt) generated.updatedAt = "updated-at";
      if (entity.softDelete === "boolean") generated.isDeleted = "soft-delete";
      if (entity.softDelete === "timestamp") generated.deletedAt = "soft-delete";
      const fields = sortedRecord(
        Object.entries(fieldDefinitions(config, name)).map(([fieldName, field]) => {
          const relation = Object.entries(entity.relations).find(
            ([, r]) =>
              (r.type === "many-to-one" || r.type === "one-to-one") &&
              (r.foreignKey ?? `${r.target.toLowerCase()}_id`) === fieldName,
          );
          const path = Object.hasOwn(entity.fields, fieldName)
            ? `entities.${name}.fields.${fieldName}`
            : relation
              ? `entities.${name}.relations.${relation[0]}.foreignKey`
              : `entities.${name}`;
          return [
            fieldName,
            resolveField(
              fieldName,
              field,
              config.enums,
              origin(path),
              generated[fieldName] ?? false,
            ),
          ];
        }),
      );
      const relations = sortedRecord(
        Object.entries(entity.relations).map(([relationName, relation]) => {
          const inverse = relation.type === "one-to-many";
          const owning = relation.type === "many-to-one" || relation.type === "one-to-one";
          const fk =
            relation.foreignKey ?? `${(inverse ? name : relation.target).toLowerCase()}_id`;
          const owningRelation = inverse
            ? Object.values(config.entities[relation.target].relations).find(
                (r) =>
                  (r.type === "many-to-one" || r.type === "one-to-one") &&
                  r.target === name &&
                  (r.foreignKey ?? `${name.toLowerCase()}_id`) === fk,
              )
            : relation;
          return [
            relationName,
            {
              ...relation,
              name: relationName,
              targetId: `${owner.get(relation.target)}.${relation.target}`,
              ownerId: moduleId,
              ...(owning || inverse
                ? { foreignKey: fk, foreignKeyEntity: inverse ? relation.target : name }
                : {
                    joinTable:
                      relation.joinTable ?? `${snakeCase(name)}_${snakeCase(relation.target)}`,
                  }),
              onDelete: owningRelation?.onDelete ?? "no-action",
              cardinality:
                inverse || relation.type === "many-to-many" ? ("many" as const) : ("one" as const),
              origin: origin(`entities.${name}.relations.${relationName}`),
            },
          ];
        }),
      );
      return [
        name,
        {
          id,
          name,
          backend: entity.backend,
          moduleId,
          table: snakeCase(name),
          page: `/${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
          ...(entity.description === undefined ? {} : { description: entity.description }),
          fields,
          relations,
          indexes: entity.indexes.map((index) => ({ fields: [...index.fields] })),
          timestamps: entity.timestamps,
          softDelete: entity.softDelete,
          generatedFields: Object.keys(fields).filter((key) => fields[key].generated),
          writableFields: Object.keys(fields).filter((key) => fields[key].writable),
          origin: origin(`entities.${name}`),
        },
      ];
    }),
  );
}
