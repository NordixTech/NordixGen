import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { composeBackendPlugins } from "../src/plugins/composer.js";
import { ARCHITECTURE_FILE_ROLES } from "../src/plugins/contracts.js";
import type {
  ArchitectureLayout,
  FrameworkContext,
  GeneratorPlugin,
  PluginDescriptor,
} from "../src/plugins/contracts.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { createValidConfig } from "./fixtures.js";

const honoContext: FrameworkContext = {
  pluginId: "hono",
  applicationRoot: "apps/api-core",
  codeRoot: "apps/api-core/src",
  language: "typescript",
  runtime: "cloudflare-workers",
  moduleSystem: "esm",
  scaffold: { executable: "pnpm", argumentsBeforeTarget: [], argumentsAfterTarget: [] },
  entryPoints: { worker: "apps/api-core/src/index.ts" },
  conventions: { importExtension: ".js" },
};

function createPluginRegistry(ormRequires: string): PluginRegistry {
  const registry = new PluginRegistry();
  const frameworkDescriptor: PluginDescriptor = {
    id: "hono",
    version: "1.0.0",
    role: "framework",
    provides: ["runtime:cloudflare-workers"],
  };
  const framework: GeneratorPlugin = {
    descriptor: frameworkDescriptor,
    createFrameworkContext: () => honoContext,
    contribute: () => [],
  };
  const architectureLayout: ArchitectureLayout = {
    pluginId: "clean",
    codeRoot: honoContext.codeRoot,
    directories: Object.fromEntries(
      ARCHITECTURE_FILE_ROLES.map((role) => [role, role]),
    ) as ArchitectureLayout["directories"],
    dependencyRules: [],
  };
  const architecture: GeneratorPlugin = {
    descriptor: {
      id: "clean",
      version: "1.0.0",
      role: "architecture",
      provides: ["architecture:clean"],
    },
    resolveArchitectureLayout: () => architectureLayout,
    contribute: () => [],
  };
  const orm: GeneratorPlugin = {
    descriptor: {
      id: "drizzle",
      version: "1.0.0",
      role: "orm",
      provides: ["orm:drizzle"],
      requires: [{ capability: ormRequires }],
    },
    contribute: () => [],
  };
  registry.register(framework);
  registry.register(architecture);
  registry.register(orm);
  return registry;
}

describe("backend persistence configuration", () => {
  it("allows backends without persistence and multiple databases with separate ORMs", () => {
    const input = createValidConfig();
    input.databases["analytics-db"] = { engine: "postgres", provider: "local" };
    input.backends.push({
      name: "analytics-api",
      framework: "hono",
      repository: "commerce",
      path: "apps/analytics-api",
      persistence: { database: "analytics-db", orm: "prisma" },
    });
    input.backends.push({
      name: "stateless-api",
      framework: "hono",
      repository: "commerce",
      path: "apps/stateless-api",
    });

    expect(validateNordixConfig(input)).toMatchObject({ success: true });
  });

  it("reports a missing database reference at the backend's persistence path", () => {
    const input = createValidConfig();
    const backend = input.backends[0];
    if (!backend) throw new Error("Fixture is incomplete.");
    backend.persistence = { database: "missing-db", orm: "drizzle" };

    const result = validateNordixConfig(input);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid database reference.");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_BACKEND_DATABASE",
        path: "backends.core-api.persistence.database",
      }),
    );
  });

  it("rejects malformed ORM plugin identifiers", () => {
    const input = createValidConfig();
    const backend = input.backends[0];
    if (!backend) throw new Error("Fixture is incomplete.");
    backend.persistence = { database: "commerce-db", orm: "Drizzle ORM" };

    expect(validateNordixConfig(input)).toMatchObject({ success: false });
  });

  it("rejects the retired singleton database format", () => {
    const input = {
      ...createValidConfig(),
      database: { engine: "postgres", provider: "neon", orm: "drizzle" },
    };
    expect(validateNordixConfig(input)).toMatchObject({ success: false });
  });

  it("resolves the configured ORM plugin against the selected database engine", () => {
    const config = NordixConfigSchema.parse(createValidConfig());
    const result = composeBackendPlugins(
      config,
      "core-api",
      createPluginRegistry("database:postgres"),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.frameworkContext).toEqual(honoContext);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a registered ORM plugin that does not support the selected database engine", () => {
    const config = NordixConfigSchema.parse(createValidConfig());
    const result = composeBackendPlugins(
      config,
      "core-api",
      createPluginRegistry("database:mysql"),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CAPABILITY_MISSING", path: "plugins.drizzle" }),
    );
  });

  it("rejects an ORM identifier that has no registered plugin", () => {
    const config = createValidConfig();
    const backend = config.backends[0];
    if (!backend?.persistence) throw new Error("Fixture persistence is missing.");
    backend.persistence.orm = "missing-orm";
    const parsed = NordixConfigSchema.parse(config);

    const result = composeBackendPlugins(
      parsed,
      "core-api",
      createPluginRegistry("database:postgres"),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_NOT_REGISTERED", path: "plugins.missing-orm" }),
    );
  });

  it("composes a backend without persistence and reports unknown backend targets", () => {
    const config = NordixConfigSchema.parse(createValidConfig());
    const backend = config.backends[0];
    if (!backend) throw new Error("Fixture backend is missing.");
    config.backends[0] = { ...backend, persistence: undefined };

    expect(
      composeBackendPlugins(config, "core-api", createPluginRegistry("database:postgres")).success,
    ).toBe(true);
    expect(
      composeBackendPlugins(config, "missing-api", createPluginRegistry("database:postgres")),
    ).toMatchObject({
      success: false,
      diagnostics: [expect.objectContaining({ code: "UNKNOWN_BACKEND_PLUGIN_TARGET" })],
    });
  });

  it("reports an unknown database when the configuration changes after parsing", () => {
    const config = NordixConfigSchema.parse({ ...createValidConfig(), databases: {} });
    expect(
      composeBackendPlugins(config, "core-api", createPluginRegistry("database:postgres")),
    ).toMatchObject({
      success: false,
      diagnostics: [expect.objectContaining({ code: "UNKNOWN_BACKEND_DATABASE" })],
    });
  });
});
