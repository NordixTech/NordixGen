import { posix } from "node:path";
import type {
  FrameworkContext,
  GeneratedFile,
  GeneratorPlugin,
  PluginSelection,
} from "../contracts.js";

const HonoScaffold = Object.freeze({
  executable: "pnpm",
  argumentsBeforeTarget: Object.freeze(["create", "hono@0.19.4"]),
  argumentsAfterTarget: Object.freeze([
    "--template",
    "cloudflare-workers",
    "--pm",
    "pnpm",
    "--install",
  ]),
});

function selectionApplicationRoot(selection: PluginSelection): string {
  const configuration = selection.configuration;
  if (
    configuration !== null &&
    typeof configuration === "object" &&
    "applicationRoot" in configuration &&
    typeof configuration.applicationRoot === "string"
  ) {
    return configuration.applicationRoot;
  }
  throw new Error('Hono plugin configuration must declare an "applicationRoot" path.');
}

function joinProjectPath(...parts: string[]): string {
  return posix.join(...parts.filter(Boolean));
}

function relativeImport(fromFile: string, toFile: string): string {
  let importPath = posix.relative(posix.dirname(fromFile), toFile).replace(/\.ts$/, ".js");
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  return importPath;
}

/** Framework integration for the Hono Cloudflare Workers Golden Path. */
export const honoFrameworkPlugin: GeneratorPlugin = {
  descriptor: {
    id: "hono",
    version: "1.0.0",
    role: "framework",
    provides: ["language:typescript", "runtime:cloudflare-workers", "module:esm"],
  },
  createFrameworkContext(selection: PluginSelection): FrameworkContext {
    const applicationRoot = selectionApplicationRoot(selection);
    const codeRoot = joinProjectPath(applicationRoot, "src");
    return {
      pluginId: "hono",
      applicationRoot,
      codeRoot,
      language: "typescript",
      runtime: "cloudflare-workers",
      moduleSystem: "esm",
      scaffold: HonoScaffold,
      entryPoints: { worker: joinProjectPath(codeRoot, "index.ts") },
      conventions: {
        importExtension: ".js",
        sourceExtension: ".ts",
        moduleKind: "esm",
        workerEntrypoint: "src/index.ts",
      },
    };
  },
  contribute({ framework, architecture }): readonly GeneratedFile[] {
    const entryPoint = framework.entryPoints.worker;
    if (!entryPoint) throw new Error('Hono framework context is missing the "worker" entry point.');

    const controllerDirectory = joinProjectPath(
      framework.codeRoot,
      architecture.directories.controller,
    );
    const healthControllerPath = joinProjectPath(controllerDirectory, "health.controller.ts");
    const routesPath = joinProjectPath(controllerDirectory, "routes.ts");
    const healthImport = relativeImport(routesPath, healthControllerPath);
    const routesImport = relativeImport(entryPoint, routesPath);

    return [
      {
        path: healthControllerPath,
        content: [
          'import { Hono } from "hono";',
          "",
          "const healthController = new Hono();",
          'healthController.get("/", (context) => context.json({ status: "ok" }));',
          "",
          "export default healthController;",
          "",
        ].join("\n"),
      },
      {
        path: routesPath,
        content: [
          'import { Hono } from "hono";',
          `import healthController from "${healthImport}";`,
          "",
          "const routes = new Hono();",
          'routes.route("/health", healthController);',
          "",
          "export default routes;",
          "",
        ].join("\n"),
      },
      {
        path: entryPoint,
        content: [
          'import { Hono } from "hono";',
          `import routes from "${routesImport}";`,
          "",
          "const app = new Hono();",
          'app.route("/", routes);',
          "",
          "export default app;",
          "",
        ].join("\n"),
      },
    ];
  },
};
