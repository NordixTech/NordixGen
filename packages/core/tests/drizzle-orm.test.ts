import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { cleanArchitecturePlugin } from "../src/plugins/architecture/clean.js";
import { composeBackendPlugins } from "../src/plugins/composer.js";
import type {
  ArchitectureLayout,
  FrameworkContext,
  GeneratorPlugin,
  PluginContributionContext,
} from "../src/plugins/contracts.js";
import { honoFrameworkPlugin } from "../src/plugins/frameworks/hono.js";
import { drizzleOrmPlugin } from "../src/plugins/orms/drizzle.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { createValidConfig } from "./fixtures.js";

function createRegistry(framework: GeneratorPlugin = honoFrameworkPlugin) {
  const registry = new PluginRegistry();
  registry.register(framework);
  registry.register(cleanArchitecturePlugin);
  registry.register(drizzleOrmPlugin);
  return registry;
}

function createDrizzleContext(
  persistence: PluginContributionContext["persistence"] | null = createValidPersistenceContext(),
): PluginContributionContext {
  const selection = { pluginId: "hono", configuration: { applicationRoot: "apps/api-core" } };
  const framework = honoFrameworkPlugin.createFrameworkContext?.(selection);
  if (!framework) throw new Error("Hono framework context is unavailable.");
  const architecture = cleanArchitecturePlugin.resolveArchitectureLayout?.(framework, {
    pluginId: "clean",
  });
  if (!architecture) throw new Error("Clean architecture layout is unavailable.");
  return {
    selection: { pluginId: "drizzle" },
    framework,
    architecture,
    availableCapabilities: new Set(),
    ...(persistence ? { persistence } : {}),
  };
}

function createValidPersistenceContext(): NonNullable<PluginContributionContext["persistence"]> {
  return {
    database: { name: "commerce-db", engine: "postgres", provider: "neon" },
    directories: {
      infrastructure: "apps/api-core/src/infrastructure",
      adapter: "apps/api-core/src/infrastructure/adapters",
    },
    connectionStringEnvironmentVariable: "DATABASE_URL",
  };
}

describe("Drizzle ORM plugin", () => {
  it("declares framework-agnostic language, runtime, database, and driver capabilities", () => {
    expect(drizzleOrmPlugin.descriptor).toMatchObject({
      id: "drizzle",
      role: "orm",
      provides: ["orm:drizzle", "driver:neon-http"],
      requires: [
        { capability: "language:typescript" },
        { capability: "runtime:cloudflare-workers" },
        { capability: "database:postgres" },
        { capability: "provider:neon" },
      ],
    });
  });

  it.each([
    ["missing persistence context", null],
    [
      "non-PostgreSQL database",
      {
        ...createValidPersistenceContext(),
        database: { name: "commerce-db", engine: "mysql", provider: "neon" },
      },
    ],
    [
      "non-Neon provider",
      {
        ...createValidPersistenceContext(),
        database: { name: "commerce-db", engine: "postgres", provider: "local" },
      },
    ],
    [
      "unexpected connection string environment variable",
      {
        ...createValidPersistenceContext(),
        connectionStringEnvironmentVariable: "DATABASE_CONNECTION",
      },
    ],
  ])("rejects %s when called without validated composition", (_label, persistence) => {
    const context = createDrizzleContext(persistence);
    expect(() => drizzleOrmPlugin.contribute(context)).toThrow();
  });

  it("generates Drizzle Kit configuration from the selected backend persistence context", () => {
    const config = NordixConfigSchema.parse(createValidConfig());
    const result = composeBackendPlugins(config, "core-api", createRegistry());

    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    expect(Object.keys(files)).toContain("apps/api-core/drizzle.config.ts");
    expect(files["apps/api-core/drizzle.config.ts"]).toContain(
      'schema: "./src/infrastructure/database/schema/index.ts"',
    );
    expect(files["apps/api-core/drizzle.config.ts"]).toContain('dialect: "postgresql"');
    expect(files["apps/api-core/drizzle.config.ts"]).toContain("process.env.DATABASE_URL");
    expect(files["apps/api-core/drizzle.config.ts"]).not.toContain("neon.tech");
    expect(files["apps/api-core/src/infrastructure/database/schema/index.ts"]).toContain(
      "export {};",
    );
  });

  it("resolves generated schema paths from the selected architecture layout", () => {
    const modularArchitecture: GeneratorPlugin = {
      descriptor: {
        id: "modular",
        version: "1.0.0",
        role: "architecture",
        provides: ["architecture:modular"],
      },
      resolveArchitectureLayout(framework): ArchitectureLayout {
        return {
          pluginId: "modular",
          codeRoot: framework.codeRoot,
          directories: {
            domainEntity: "domain",
            useCase: "application/use-cases",
            inboundPort: "application/ports/inbound",
            outboundPort: "application/ports/outbound",
            adapter: "persistence/adapters",
            controller: "http/controllers",
            infrastructure: "persistence",
          },
          dependencyRules: [],
        };
      },
      contribute: () => [],
    };
    const registry = new PluginRegistry();
    registry.register(honoFrameworkPlugin);
    registry.register(modularArchitecture);
    registry.register(drizzleOrmPlugin);
    const config = createValidConfig();
    const backend = config.backends[0];
    if (!backend) throw new Error("Fixture backend is missing.");
    backend.architecture = "modular";

    const result = composeBackendPlugins(NordixConfigSchema.parse(config), "core-api", registry);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.virtualFileSystem.snapshot()["apps/api-core/drizzle.config.ts"]).toContain(
      'schema: "./src/persistence/database/schema/index.ts"',
    );
  });

  it.each([
    ["database engine", { engine: "mysql", provider: "neon" }],
    ["database provider", { engine: "postgres", provider: "local" }],
  ])("rejects an unsupported %s before generating files", (_label, database) => {
    const config = createValidConfig();
    config.databases["commerce-db"] = database;
    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CAPABILITY_MISSING", path: "plugins.drizzle" }),
    );
  });

  it("rejects a TypeScript framework on an unsupported runtime before contribution", () => {
    const frameworkContext: FrameworkContext = {
      pluginId: "node-framework",
      applicationRoot: "apps/api-core",
      codeRoot: "apps/api-core/src",
      language: "typescript",
      runtime: "node",
      moduleSystem: "esm",
      scaffold: { executable: "pnpm", argumentsBeforeTarget: [], argumentsAfterTarget: [] },
      entryPoints: { app: "apps/api-core/src/index.ts" },
      conventions: { importExtension: ".js" },
    };
    const nodeFrameworkPlugin: GeneratorPlugin = {
      descriptor: {
        id: "node-framework",
        version: "1.0.0",
        role: "framework",
        provides: ["language:typescript", "runtime:node"],
      },
      createFrameworkContext: () => frameworkContext,
      contribute: () => [],
    };
    const config = createValidConfig();
    const backend = config.backends[0];
    if (!backend) throw new Error("Fixture backend is missing.");
    backend.framework = "node-framework";
    const result = composeBackendPlugins(
      NordixConfigSchema.parse(config),
      "core-api",
      createRegistry(nodeFrameworkPlugin),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CAPABILITY_MISSING", path: "plugins.drizzle" }),
    );
  });
});
