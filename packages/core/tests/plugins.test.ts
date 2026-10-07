import { describe, expect, it, vi } from "vitest";
import { composePlugins } from "../src/plugins/composer.js";
import type {
  ArchitectureLayout,
  FrameworkContext,
  GeneratedFile,
  GeneratorPlugin,
  PluginDescriptor,
  PluginRole,
} from "../src/plugins/contracts.js";
import {
  PluginRegistrationError,
  PluginRegistry,
  validatePluginDescriptor,
} from "../src/plugins/registry.js";

const frameworkContext: FrameworkContext = {
  pluginId: "hono",
  applicationRoot: "apps/api",
  codeRoot: "apps/api/src",
  language: "typescript",
  runtime: "cloudflare-workers",
  moduleSystem: "esm",
  entryPoints: { worker: "apps/api/src/index.ts" },
  conventions: { importExtension: ".js" },
};

const architectureLayout: ArchitectureLayout = {
  pluginId: "clean",
  codeRoot: frameworkContext.codeRoot,
  directories: {
    domainEntity: "domain/entities",
    useCase: "application/use-cases",
    inboundPort: "application/ports/inbound",
    outboundPort: "application/ports/outbound",
    adapter: "infrastructure/adapters",
    controller: "presentation/controllers",
    infrastructure: ".",
  },
  dependencyRules: [
    { from: "controller", to: "useCase" },
    { from: "adapter", to: "outboundPort" },
  ],
};

function descriptor(id: string, role: PluginRole, provides: string[] = []): PluginDescriptor {
  return { id, version: "1.0.0", role, provides };
}

function frameworkPlugin(contribute = vi.fn(() => [])): GeneratorPlugin {
  return {
    descriptor: descriptor("hono", "framework", [
      "language:typescript",
      "runtime:cloudflare-workers",
    ]),
    createFrameworkContext: () => frameworkContext,
    contribute,
  };
}

function architecturePlugin(contribute = vi.fn(() => [])): GeneratorPlugin {
  return {
    descriptor: descriptor("clean", "architecture", ["architecture:clean"]),
    resolveArchitectureLayout: () => architectureLayout,
    contribute,
  };
}

function createRegistry(...additionalPlugins: GeneratorPlugin[]): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(frameworkPlugin());
  registry.register(architecturePlugin());
  for (const plugin of additionalPlugins) registry.register(plugin);
  return registry;
}

function compose(registry: PluginRegistry, pluginIds = ["hono", "clean"]) {
  return composePlugins({
    registry,
    selections: pluginIds.map((pluginId) => ({ pluginId })),
  });
}

describe("plugin registry", () => {
  it("rejects duplicate plugin identifiers and invalid plugin contracts", () => {
    const registry = createRegistry();
    expect(() => registry.register(frameworkPlugin())).toThrow(PluginRegistrationError);
    expect(() =>
      registry.register({ descriptor: descriptor("bad plugin", "orm"), contribute: () => [] }),
    ).toThrow(PluginRegistrationError);
    expect(() =>
      registry.register({
        descriptor: descriptor("bad-framework", "framework"),
        contribute: () => [],
      }),
    ).toThrow(/createFrameworkContext/);
    expect(() =>
      registry.register({
        descriptor: descriptor("bad-architecture", "architecture"),
        contribute: () => [],
      }),
    ).toThrow(/resolveArchitectureLayout/);
    expect(() =>
      registry.register({ descriptor: descriptor("no-contribution", "orm") } as GeneratorPlugin),
    ).toThrow(/contribute/);
  });

  it("validates plugin descriptor identifiers, versions, roles, and capability declarations", () => {
    const valid = descriptor("plugin-one", "orm", ["orm:postgres"]);
    expect(validatePluginDescriptor(valid)).toBe(true);
    expect(validatePluginDescriptor(null)).toBe(false);
    expect(validatePluginDescriptor({ ...valid, id: "Invalid" })).toBe(false);
    expect(validatePluginDescriptor({ ...valid, version: "latest" })).toBe(false);
    expect(validatePluginDescriptor({ ...valid, role: "database" })).toBe(false);
    expect(validatePluginDescriptor({ ...valid, provides: ["Invalid capability"] })).toBe(false);
    expect(validatePluginDescriptor({ ...valid, provides: ["orm:postgres", "orm:postgres"] })).toBe(
      false,
    );
    expect(validatePluginDescriptor({ ...valid, requires: ["orm:postgres"] })).toBe(false);
    expect(
      validatePluginDescriptor({
        ...valid,
        requires: [{ capability: "bad capability" }],
      }),
    ).toBe(false);
    expect(
      validatePluginDescriptor({
        ...valid,
        requires: [{ capability: "orm:postgres", optional: "yes" }],
      }),
    ).toBe(false);
    expect(
      validatePluginDescriptor({
        ...valid,
        requires: [{ capability: "orm:postgres", description: 1 }],
      }),
    ).toBe(false);
  });

  it("lists registered plugin descriptors in a stable order", () => {
    const registry = createRegistry({
      descriptor: descriptor("drizzle", "orm", ["orm:drizzle"]),
      contribute: () => [],
    });
    expect(registry.list().map(({ id }) => id)).toEqual(["clean", "drizzle", "hono"]);
  });

  it("keeps a stable immutable descriptor snapshot after registration", () => {
    const registeredPlugin: GeneratorPlugin = {
      descriptor: descriptor("drizzle", "orm", ["orm:drizzle"]),
      contribute: () => [],
    };
    const registry = new PluginRegistry();
    registry.register(registeredPlugin);
    (registeredPlugin as unknown as { descriptor: PluginDescriptor }).descriptor = descriptor(
      "changed",
      "orm",
    );

    expect(registry.get("drizzle")?.descriptor.id).toBe("drizzle");
    expect(registry.get("drizzle")?.descriptor.provides).toEqual(["orm:drizzle"]);
    expect(Object.isFrozen(registry.get("drizzle")?.descriptor)).toBe(true);
    expect(Object.isFrozen(registry.get("drizzle")?.descriptor.provides)).toBe(true);
  });
});

describe("plugin composition", () => {
  it("resolves framework context and architecture layout before contributions", () => {
    const contribute = vi.fn(() => [{ path: "apps/api/src/main.ts", content: "export {};\n" }]);
    const registry = createRegistry({
      descriptor: descriptor("drizzle", "orm", ["orm:drizzle"]),
      contribute,
    });

    const result = compose(registry, ["hono", "clean", "drizzle"]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.frameworkContext).toEqual(frameworkContext);
    expect(result.architectureLayout).toEqual(architectureLayout);
    expect(result.virtualFileSystem.snapshot()).toEqual({ "apps/api/src/main.ts": "export {};\n" });
    expect(Object.isFrozen(result.frameworkContext)).toBe(true);
    expect(Object.isFrozen(result.frameworkContext.entryPoints)).toBe(true);
    expect(Object.isFrozen(result.architectureLayout)).toBe(true);
    expect(Object.isFrozen(result.architectureLayout.dependencyRules[0])).toBe(true);
    expect(contribute).toHaveBeenCalledWith({
      selection: { pluginId: "drizzle" },
      framework: frameworkContext,
      architecture: architectureLayout,
      availableCapabilities: new Set([
        "language:typescript",
        "runtime:cloudflare-workers",
        "architecture:clean",
        "orm:drizzle",
      ]),
    });
  });

  it("reports unknown plugins and missing required roles without producing output", () => {
    const result = compose(createRegistry(), ["missing-plugin"]);
    expect(result).toEqual({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_NOT_REGISTERED" }),
        expect.objectContaining({ code: "PLUGIN_ROLE_REQUIRED", path: "plugins.framework" }),
        expect.objectContaining({ code: "PLUGIN_ROLE_REQUIRED", path: "plugins.architecture" }),
      ]),
    });
  });

  it("reports incompatible capabilities before invoking plugin contributions", () => {
    const contribute = vi.fn(() => []);
    const authPlugin: GeneratorPlugin = {
      descriptor: {
        ...descriptor("better-auth", "authentication"),
        requires: [{ capability: "orm:drizzle" }],
      },
      contribute,
    };
    const registry = createRegistry(authPlugin);

    const result = compose(registry, ["hono", "clean", "better-auth"]);

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_CAPABILITY_MISSING", path: "plugins.better-auth" }),
      ]),
    );
    expect(contribute).not.toHaveBeenCalled();
  });

  it("resolves a required capability when a selected plugin provides it", () => {
    const registry = createRegistry(
      {
        descriptor: descriptor("drizzle", "orm", ["orm:drizzle"]),
        contribute: () => [],
      },
      {
        descriptor: {
          ...descriptor("better-auth", "authentication"),
          requires: [{ capability: "orm:drizzle" }],
        },
        contribute: () => [],
      },
    );
    const result = compose(registry, ["hono", "clean", "drizzle", "better-auth"]);

    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps composition available when an optional capability is missing", () => {
    const registry = createRegistry({
      descriptor: {
        ...descriptor("drizzle", "orm"),
        requires: [{ capability: "database:sqlite", optional: true }],
      },
      contribute: () => [],
    });
    const result = compose(registry, ["hono", "clean", "drizzle"]);

    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "PLUGIN_OPTIONAL_CAPABILITY_UNAVAILABLE",
        severity: "warning",
      }),
    ]);
  });

  it("rejects duplicate roles and duplicate selections", () => {
    const secondFramework: GeneratorPlugin = {
      ...frameworkPlugin(),
      descriptor: descriptor("other-framework", "framework"),
    };
    const registry = createRegistry(secondFramework);
    const duplicateRole = compose(registry, ["hono", "other-framework", "clean"]);
    const duplicateSelection = compose(registry, ["hono", "hono", "clean"]);

    expect(duplicateRole.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_ROLE_SELECTED_MORE_THAN_ONCE" }),
      ]),
    );
    expect(duplicateSelection.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PLUGIN_SELECTED_MORE_THAN_ONCE" })]),
    );
  });

  it("returns no partial virtual file system when plugins collide or return unsafe paths", () => {
    const registry = createRegistry(
      {
        descriptor: descriptor("drizzle", "orm"),
        contribute: () => [{ path: "./apps/api/src/main.ts", content: "one" }],
      },
      {
        descriptor: descriptor("better-auth", "authentication"),
        contribute: () => [{ path: "apps/api/src/main.ts", content: "two" }],
      },
    );
    const collision = compose(registry, ["hono", "clean", "drizzle", "better-auth"]);
    expect(collision.success).toBe(false);
    expect(collision.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PLUGIN_OUTPUT_PATH_COLLISION" })]),
    );

    const unsafeRegistry = createRegistry({
      descriptor: descriptor("drizzle", "orm"),
      contribute: () => [{ path: "../outside.ts", content: "unsafe" }],
    });
    const unsafePath = compose(unsafeRegistry, ["hono", "clean", "drizzle"]);
    expect(unsafePath.success).toBe(false);
    expect(unsafePath.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PLUGIN_OUTPUT_PATH_INVALID" })]),
    );
  });

  it("rejects malformed plugin output files", () => {
    const registry = createRegistry({
      descriptor: descriptor("drizzle", "orm"),
      contribute: () => [null] as unknown as GeneratedFile[],
    });
    const result = compose(registry, ["hono", "clean", "drizzle"]);

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PLUGIN_OUTPUT_FILE_INVALID" })]),
    );
  });

  it("rejects invalid framework contexts and architecture layouts", () => {
    const wrongFrameworkContext = new PluginRegistry();
    wrongFrameworkContext.register({
      ...frameworkPlugin(),
      createFrameworkContext: () => ({ ...frameworkContext, pluginId: "other" }),
    });
    wrongFrameworkContext.register(architecturePlugin());
    expect(compose(wrongFrameworkContext).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
      ]),
    );

    const missingFrameworkContext = new PluginRegistry();
    missingFrameworkContext.register({
      ...frameworkPlugin(),
      createFrameworkContext: () => undefined as unknown as FrameworkContext,
    });
    missingFrameworkContext.register(architecturePlugin());
    expect(compose(missingFrameworkContext).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
      ]),
    );

    const wrongArchitectureRoot = new PluginRegistry();
    wrongArchitectureRoot.register(frameworkPlugin());
    wrongArchitectureRoot.register({
      ...architecturePlugin(),
      resolveArchitectureLayout: () => ({ ...architectureLayout, codeRoot: "src" }),
    });
    expect(compose(wrongArchitectureRoot).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
      ]),
    );

    const wrongArchitectureId = new PluginRegistry();
    wrongArchitectureId.register(frameworkPlugin());
    wrongArchitectureId.register({
      ...architecturePlugin(),
      resolveArchitectureLayout: () => ({ ...architectureLayout, pluginId: "other" }),
    });
    expect(compose(wrongArchitectureId).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
      ]),
    );

    const missingArchitectureLayout = new PluginRegistry();
    missingArchitectureLayout.register(frameworkPlugin());
    missingArchitectureLayout.register({
      ...architecturePlugin(),
      resolveArchitectureLayout: () => undefined as unknown as ArchitectureLayout,
    });
    expect(compose(missingArchitectureLayout).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
      ]),
    );

    const unexpectedContextFailure = new PluginRegistry();
    unexpectedContextFailure.register({
      ...frameworkPlugin(),
      createFrameworkContext: () => {
        throw "unexpected context value";
      },
    });
    unexpectedContextFailure.register(architecturePlugin());
    expect(compose(unexpectedContextFailure).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
      ]),
    );

    const invalidContexts: unknown[] = [
      "not-an-object",
      { ...frameworkContext, language: "" },
      { ...frameworkContext, codeRoot: "packages/shared/src" },
      { ...frameworkContext, applicationRoot: "./apps/api" },
      { ...frameworkContext, entryPoints: { worker: 123 } },
      { ...frameworkContext, conventions: { module: 123 } },
    ];
    for (const context of invalidContexts) {
      const registry = new PluginRegistry();
      registry.register({
        ...frameworkPlugin(),
        createFrameworkContext: () => context as FrameworkContext,
      });
      registry.register(architecturePlugin());
      expect(compose(registry).diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
        ]),
      );
    }

    const invalidLayouts: unknown[] = [
      "not-an-object",
      { ...architectureLayout, directories: undefined },
      {
        ...architectureLayout,
        directories: { ...architectureLayout.directories, controller: undefined },
      },
      { ...architectureLayout, dependencyRules: undefined },
      {
        ...architectureLayout,
        dependencyRules: [{ from: "unknown", to: "useCase" }],
      },
      {
        ...architectureLayout,
        dependencyRules: [{ from: "controller", to: "unknown" }],
      },
    ];
    for (const layout of invalidLayouts) {
      const registry = new PluginRegistry();
      registry.register(frameworkPlugin());
      registry.register({
        ...architecturePlugin(),
        resolveArchitectureLayout: () => layout as ArchitectureLayout,
      });
      expect(compose(registry).diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
        ]),
      );
    }
  });

  it("contains unexpected failures while reading a plugin output path", () => {
    let pathReads = 0;
    const generatedFile = {
      get path() {
        pathReads += 1;
        if (pathReads === 2) throw "invalid path value";
        return "valid.ts";
      },
      content: "contents",
    } as GeneratedFile;
    const registry = createRegistry({
      descriptor: descriptor("drizzle", "orm"),
      contribute: () => [generatedFile],
    });
    const result = compose(registry, ["hono", "clean", "drizzle"]);

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PLUGIN_OUTPUT_PATH_INVALID" })]),
    );
  });

  it("contains unexpected plugin failures and rejects non-array contributions", () => {
    const thrownValue = createRegistry({
      descriptor: descriptor("drizzle", "orm"),
      contribute: () => {
        throw "unexpected value";
      },
    });
    expect(compose(thrownValue, ["hono", "clean", "drizzle"]).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PLUGIN_CONTRIBUTION_FAILED" })]),
    );

    const nonArrayContribution = createRegistry({
      descriptor: descriptor("drizzle", "orm"),
      contribute: () => undefined as unknown as GeneratedFile[],
    });
    expect(compose(nonArrayContribution, ["hono", "clean", "drizzle"]).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PLUGIN_CONTRIBUTION_FAILED" })]),
    );
  });

  it("produces stable file order regardless of selection order", () => {
    const registry = createRegistry(
      {
        descriptor: descriptor("drizzle", "orm"),
        contribute: () => [{ path: "z-file.ts", content: "z" }],
      },
      {
        descriptor: descriptor("better-auth", "authentication"),
        contribute: () => [{ path: "a-file.ts", content: "a" }],
      },
    );
    const first = compose(registry, ["hono", "clean", "drizzle", "better-auth"]);
    const second = compose(registry, ["better-auth", "clean", "hono", "drizzle"]);

    expect(first.success && first.virtualFileSystem.listFiles()).toEqual([
      "a-file.ts",
      "z-file.ts",
    ]);
    expect(second.success && second.virtualFileSystem.snapshot()).toEqual(
      first.success ? first.virtualFileSystem.snapshot() : {},
    );
  });

  it("turns plugin failures into diagnostics and returns no partial output", () => {
    const registry = createRegistry({
      descriptor: descriptor("drizzle", "orm"),
      contribute: () => {
        throw new Error("adapter generation failed");
      },
    });
    const result = compose(registry, ["hono", "clean", "drizzle"]);

    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PLUGIN_CONTRIBUTION_FAILED",
          message: "adapter generation failed",
        }),
      ]),
    );
  });
});
