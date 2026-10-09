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
  const enumNames = [
    ...new Set(
      Object.values(entity.fields)
        .filter((field) => field.type === "enum")
        .map((field) => field.enumName),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return [
    ...(enumNames.length > 0
      ? enumNames
          .map((enumName) => `import type { ${enumName} } from "./${enumName}.enum.js";`)
          .concat("")
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
  ].join("\n");
}

function enumFiles(model: DomainModelContext, entityDirectory: string): GeneratedFile[] {
  return Object.entries(model.enums)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, values]) => ({
      path: posix.join(entityDirectory, `${name}.enum.ts`),
      content: `export type ${name} = ${values.map((value) => JSON.stringify(value)).join(" | ")};\n`,
    }));
}

function repositoryFile(
  name: string,
  entityPath: string,
  repositoryDirectory: string,
  supportsPagination: boolean,
): string {
  const entityImport = relativeImport(repositoryDirectory, entityPath.replace(/\.ts$/, ".js"));
  return [
    `import type { ${name}, Create${name}Input } from "${entityImport}";`,
    "",
    `export interface ${name}Repository {`,
    `  findById(id: string): Promise<${name} | null>;`,
    `  findMany(filter?: Partial<${name}>): Promise<readonly ${name}[]>;`,
    ...(supportsPagination
      ? [
          `  findPage(filter: Partial<${name}>, offset: number, limit: number): Promise<{ items: readonly ${name}[]; total: number }>;`,
        ]
      : []),
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
  const files: GeneratedFile[] = enumFiles(model, entityDirectory);

  for (const name of Object.keys(model.entities).sort((left, right) => left.localeCompare(right))) {
    const entityPath = posix.join(entityDirectory, `${name}.entity.ts`);
    files.push({ path: entityPath, content: entityFile(name, model) });
    files.push({
      path: posix.join(repositoryDirectory, `${name}.repository.ts`),
      content: repositoryFile(
        name,
        entityPath,
        repositoryDirectory,
        model.endpoints.some(
          (endpoint) => endpoint.entity === name && endpoint.pagination !== undefined,
        ),
      ),
    });
  }
  return files;
}
