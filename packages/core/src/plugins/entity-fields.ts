import type { FieldDefinition } from "../configuration/schema.js";
import type { DomainModelContext } from "./contracts.js";

/** Include relation-owned foreign-key fields in generated domain and transport shapes. */
export function entityFieldsWithRelationKeys(
  entity: DomainModelContext["entities"][string],
): Record<string, FieldDefinition> {
  const fields: Record<string, FieldDefinition> = { ...entity.fields };
  for (const relation of Object.values(entity.relations)) {
    if (relation.type !== "many-to-one" && relation.type !== "one-to-one") continue;
    const fieldName = relation.foreignKey ?? `${relation.target.toLowerCase()}_id`;
    fields[fieldName] ??= {
      type: "uuid",
      required: relation.required,
      unique: relation.type === "one-to-one",
    };
  }
  return fields;
}
