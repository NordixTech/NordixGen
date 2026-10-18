import { posix } from "node:path";
import type { BackendRenderContext } from "../contracts.js";
import {
  generateDrizzleDatabaseFile,
  generateDrizzleMigrationFiles,
  generateDrizzleSchemaFiles,
  generateDrizzleSeedFiles,
} from "./drizzle-files.js";
export function generateDrizzleFiles(context: BackendRenderContext) {
  const persistence = context.persistence;
  if (!persistence) throw new Error("A resolved database is required for Drizzle generation.");
  const appRelativeSchemaPath = posix.relative(
    context.framework.applicationRoot,
    schemaFilePath(persistence.directories.infrastructure),
  );
  const schemaPath = `./${appRelativeSchemaPath}`;
  const configPath = posix.join(context.framework.applicationRoot, "drizzle.config.ts");

  const configFile = {
    path: configPath,
    content: [
      'import { defineConfig } from "drizzle-kit";',
      "",
      `const databaseUrl = process.env.${persistence.connectionStringEnvironmentVariable} ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";`,
      "",
      "export default defineConfig({",
      '  dialect: "postgresql",',
      `  schema: "${schemaPath}",`,
      '  out: "./drizzle",',
      "  dbCredentials: { url: databaseUrl },",
      "});",
      "",
    ].join("\n"),
  };

  const schemaFiles = generateDrizzleSchemaFiles(context, persistence);
  const databaseFile = generateDrizzleDatabaseFile(context, persistence);
  const migrationFiles = generateDrizzleMigrationFiles(context, persistence);
  const seedFiles = generateDrizzleSeedFiles(context, persistence);

  return [configFile, ...schemaFiles, databaseFile, ...migrationFiles, ...seedFiles];
}
function schemaFilePath(infrastructure: string): string {
  return posix.join(infrastructure, "database/schema/index.ts");
}
