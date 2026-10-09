import { posix } from "node:path";
import type { FieldDefinition } from "../../configuration/schema.js";
import type { DomainModelContext, GeneratedFile, PluginContributionContext } from "../contracts.js";

function typeForField(field: FieldDefinition): string {
  switch (field.type) {
    case "string":
    case "uuid":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "Date";
    case "json":
      return "unknown";
    case "enum":
      return field.enumName;
  }
}

function relativeImport(fromDirectory: string, targetPath: string): string {
  const relativePath = posix.relative(fromDirectory, targetPath);
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function entityFile(name: string, model: DomainModelContext): string {
  const entity = model.entities[name];
  if (!entity) throw new Error(`Domain model is missing entity "${name}".`);
  const fields = Object.entries(entity.fields).map(([fieldName, field]) => {
    const nullable = fieldName !== "id" && field.required === false ? " | null" : "";
    return `  ${JSON.stringify(fieldName)}: ${typeForField(field)}${nullable};`;
  });
  const generatedFields = [
    "id",
    ...(entity.timestamps.createdAt ? ["createdAt"] : []),
    ...(entity.timestamps.updatedAt ? ["updatedAt"] : []),
    ...(entity.softDelete === "boolean" ? ["isDeleted"] : []),
    ...(entity.softDelete === "timestamp" ? ["deletedAt"] : []),
  ];
  const optionalCreateFields = Object.entries(entity.fields)
    .filter(
      ([fieldName, field]) =>
        !generatedFields.includes(fieldName) &&
        (field.required === false || field.default !== undefined),
    )
    .map(([fieldName]) => fieldName);
  const metadata = {
    fields: Object.fromEntries(
      Object.entries(entity.fields).map(([fieldName, field]) => [
        fieldName,
        {
          type: field.type,
          required: field.required,
          unique: field.unique,
          ...(field.default === undefined ? {} : { default: field.default }),
        },
      ]),
    ),
    relations: Object.fromEntries(
      Object.entries(entity.relations).map(([relationName, relation]) => [
        relationName,
        {
          type: relation.type,
          target: relation.target,
          ...(relation.foreignKey === undefined ? {} : { foreignKey: relation.foreignKey }),
          ...(relation.joinTable === undefined ? {} : { joinTable: relation.joinTable }),
          required: relation.required,
          onDelete: relation.onDelete,
        },
      ]),
    ),
    timestamps: entity.timestamps,
    softDelete: entity.softDelete,
  };
  const enumNames = [
    ...new Set(
      Object.values(entity.fields)
        .filter((field) => field.type === "enum")
        .map((field) => field.enumName),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return [
    ...(enumNames.length > 0
      ? [`import type { ${enumNames.join(", ")} } from "./enums.js";`, ""]
      : []),
    `export interface ${name} {`,
    ...fields,
    "}",
    "",
    `export type Create${name}Input = Omit<${name}, ${[...generatedFields, ...optionalCreateFields].map((field) => JSON.stringify(field)).join(" | ")}>${
      optionalCreateFields.length > 0
        ? ` & Partial<Pick<${name}, ${optionalCreateFields.map((field) => JSON.stringify(field)).join(" | ")}>>`
        : ""
    };`,
    "",
    `export const ${name}Metadata = ${JSON.stringify(metadata, null, 2)} as const;`,
    "",
  ].join("\n");
}

function enumFile(model: DomainModelContext): string {
  const declarations = Object.entries(model.enums)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, values]) =>
        `export type ${name} = ${values.map((value) => JSON.stringify(value)).join(" | ")};`,
    );
  return declarations.length === 0 ? "export {};\n" : `${declarations.join("\n")}\n`;
}

function repositoryFile(name: string, entityPath: string, repositoryDirectory: string): string {
  const entityImport = relativeImport(repositoryDirectory, entityPath.replace(/\.ts$/, ".js"));
  return [
    `import type { ${name}, Create${name}Input } from "${entityImport}";`,
    "",
    `export interface ${name}Repository {`,
    `  findById(id: string): Promise<${name} | null>;`,
    `  findMany(filter?: Partial<${name}>): Promise<readonly ${name}[]>;`,
    `  findPage(filter: Partial<${name}>, offset: number, limit: number): Promise<{ items: readonly ${name}[]; total: number }>;`,
    `  create(input: Create${name}Input): Promise<${name}>;`,
    `  update(id: string, changes: Partial<Omit<${name}, "id">>): Promise<${name} | null>;`,
    `  save(entity: ${name}): Promise<${name}>;`,
    "  delete(id: string): Promise<void>;",
    "}",
    "",
  ].join("\n");
}

/** Produces deterministic, dependency-free domain artifacts in architecture-resolved paths. */
export function generateDomainFiles(context: PluginContributionContext): readonly GeneratedFile[] {
  const model = context.domainModel;
  if (!model) return [];

  const entityDirectory = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.domainEntity,
  );
  const repositoryDirectory = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.outboundPort,
  );
  const files: GeneratedFile[] = [
    { path: posix.join(entityDirectory, "enums.ts"), content: enumFile(model) },
  ];

  for (const name of Object.keys(model.entities).sort((left, right) => left.localeCompare(right))) {
    const entityPath = posix.join(entityDirectory, `${name}.entity.ts`);
    files.push({ path: entityPath, content: entityFile(name, model) });
    files.push({
      path: posix.join(repositoryDirectory, `${name}.repository.ts`),
      content: repositoryFile(name, entityPath, repositoryDirectory),
    });
  }
  return files;
}
