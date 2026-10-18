import { posix } from "node:path";
import type { ResolvedField } from "../../project/types.js";
import type { BackendRenderContext, DomainModelContext, GeneratedFile } from "../contracts.js";

function typeForField(field: ResolvedField): string {
  return field.type === "enum" ? field.enumName : field.value.applicationType;
}

function entityFile(name: string, model: DomainModelContext): string {
  const fields = Object.entries(model.entities[name].fields);
  const enumNames = [
    ...new Set(fields.flatMap(([, field]) => (field.type === "enum" ? [field.enumName] : []))),
  ].sort();
  return [
    ...enumNames.map((name) => `import type { ${name} } from "./${name}.enum.js";`),
    `export interface ${name} {`,
    ...fields.map(
      ([name, field]) =>
        `  ${JSON.stringify(name)}: ${typeForField(field)}${field.nullable ? " | null" : ""};`,
    ),
    "}",
    "",
  ].join("\n");
}

/** Domain describes entity state; operation ports belong to declared application operations. */
export function generateDomainFiles(context: BackendRenderContext): readonly GeneratedFile[] {
  const model = context.domainModel;
  const directory = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.domainEntity,
  );
  return [
    ...Object.entries(model.enums)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, values]) => ({
        path: posix.join(directory, `${name}.enum.ts`),
        content: `export type ${name} = ${values.map((value) => JSON.stringify(value)).join(" | ")};\n`,
      })),
    ...Object.keys(model.entities)
      .sort()
      .map((name) => ({
        path: posix.join(directory, `${name}.entity.ts`),
        content: entityFile(name, model),
      })),
  ];
}
