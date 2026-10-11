import { posix } from "node:path";
import type { GeneratorPlugin, PluginContributionContext } from "../contracts.js";
import {
  generateDrizzleAdapterFiles,
  generateDrizzleMigrationFiles,
  generateDrizzleSchemaFiles,
  generateDrizzleSeedFiles,
} from "./drizzle-files.js";

const DATABASE_URL_ENVIRONMENT_VARIABLE = "DATABASE_URL";
const DRIZZLE_SCHEMA_DIRECTORY = "database/schema";

export const drizzleOrmPlugin: GeneratorPlugin = {
  descriptor: {
    id: "drizzle",
    version: "1.0.0",
    role: "orm",
    provides: ["orm:drizzle", "driver:neon-http"],
    requires: [
      {
        capability: "language:typescript",
        description: "The Drizzle Neon HTTP driver requires a TypeScript backend.",
      },
      {
        capability: "runtime:cloudflare-workers",
        description: "The initial Drizzle driver is supported on Cloudflare Workers.",
      },
      {
        capability: "database:postgres",
        description: "The Drizzle Neon HTTP driver requires PostgreSQL.",
      },
      {
        capability: "provider:neon",
        description: "The initial Drizzle driver supports Neon PostgreSQL databases.",
      },
    ],
    dependencies: {
      "drizzle-orm": "^0.39.0",
      "drizzle-kit": "^0.30.5",
      "@neondatabase/serverless": "^0.10.4",
      "@faker-js/faker": "^9.5.0",
    },
  },
  contribute(context: PluginContributionContext) {
    const persistence = requireDrizzlePersistenceContext(context);
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
    const adapterFiles = generateDrizzleAdapterFiles(context, persistence);
    const migrationFiles = generateDrizzleMigrationFiles(context, persistence);
    const seedFiles = generateDrizzleSeedFiles(context, persistence);

    return [configFile, ...schemaFiles, ...adapterFiles, ...migrationFiles, ...seedFiles];
  },
};

function requireDrizzlePersistenceContext(context: PluginContributionContext) {
  const persistence = context.persistence;
  if (!persistence) {
    throw new Error("Drizzle requires a backend persistence context before generation.");
  }
  if (persistence.database.engine !== "postgres" || persistence.database.provider !== "neon") {
    throw new Error("Drizzle's initial driver requires a Neon PostgreSQL database.");
  }
  if (persistence.connectionStringEnvironmentVariable !== DATABASE_URL_ENVIRONMENT_VARIABLE) {
    throw new Error(
      `Drizzle's Neon driver expects the ${DATABASE_URL_ENVIRONMENT_VARIABLE} environment variable.`,
    );
  }
  return persistence;
}

function schemaFilePath(infrastructureDirectory: string): string {
  return posix.join(infrastructureDirectory, DRIZZLE_SCHEMA_DIRECTORY, "index.ts");
}
