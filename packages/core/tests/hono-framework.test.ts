import { describe, expect, it } from "vitest";
import { cleanArchitecturePlugin } from "../src/plugins/architecture/clean.js";
import { composePlugins } from "../src/plugins/composer.js";
import { honoFrameworkPlugin } from "../src/plugins/frameworks/hono.js";
import { PluginRegistry } from "../src/plugins/registry.js";

function composeHono(applicationRoot: string) {
  const registry = new PluginRegistry();
  registry.register(honoFrameworkPlugin);
  registry.register(cleanArchitecturePlugin);
  return composePlugins({
    registry,
    selections: [{ pluginId: "hono", configuration: { applicationRoot } }, { pluginId: "clean" }],
  });
}

describe("Hono framework plugin", () => {
  it("provides a Cloudflare Workers context and official Hono scaffold plan", () => {
    const result = composeHono("apps/api");
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.frameworkContext).toMatchObject({
      applicationRoot: "apps/api",
      codeRoot: "apps/api/src",
      language: "typescript",
      runtime: "cloudflare-workers",
      moduleSystem: "esm",
      scaffold: {
        executable: "pnpm",
        argumentsBeforeTarget: ["create", "hono@0.19.4"],
        argumentsAfterTarget: ["--template", "cloudflare-workers", "--pm", "pnpm", "--install"],
      },
      entryPoints: { worker: "apps/api/src/index.ts" },
      conventions: { importExtension: ".js", sourceExtension: ".ts", moduleKind: "esm" },
    });
  });

  it("generates Hono controllers, route registration, and bootstrap imports under the app source root", () => {
    const result = composeHono("packages/services/api");
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    expect(Object.keys(files)).toEqual([
      "packages/services/api/src/index.ts",
      "packages/services/api/src/presentation/controllers/health.controller.ts",
      "packages/services/api/src/presentation/controllers/routes.ts",
    ]);
    expect(files["packages/services/api/src/index.ts"]).toContain(
      'from "./presentation/controllers/routes.js"',
    );
    expect(files["packages/services/api/src/presentation/controllers/routes.ts"]).toContain(
      'from "./health.controller.js"',
    );
    expect(files["packages/services/api/src/presentation/controllers/routes.ts"]).toContain(
      'routes.route("/health", healthController);',
    );
    expect(
      files["packages/services/api/src/presentation/controllers/health.controller.ts"],
    ).toContain('healthController.get("/", (context) => context.json({ status: "ok" }));');
  });

  it("rejects a missing application root before contributing files", () => {
    const registry = new PluginRegistry();
    registry.register(honoFrameworkPlugin);
    registry.register(cleanArchitecturePlugin);
    const result = composePlugins({
      registry,
      selections: [{ pluginId: "hono" }, { pluginId: "clean" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CONTEXT_RESOLUTION_FAILED" }),
    );
  });

  it("rejects a context without the worker entry point", () => {
    const registry = new PluginRegistry();
    registry.register({
      ...honoFrameworkPlugin,
      createFrameworkContext: () =>
        ({
          ...honoFrameworkPlugin.createFrameworkContext?.({
            pluginId: "hono",
            configuration: { applicationRoot: "apps/api" },
          }),
          entryPoints: {},
        }) as NonNullable<ReturnType<typeof honoFrameworkPlugin.createFrameworkContext>>,
    });
    registry.register(cleanArchitecturePlugin);
    const result = composePlugins({
      registry,
      selections: [
        { pluginId: "hono", configuration: { applicationRoot: "apps/api" } },
        { pluginId: "clean" },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_CONTRIBUTION_FAILED", path: "plugins.hono" }),
    );
  });
});
