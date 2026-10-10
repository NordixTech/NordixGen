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

import { generateHonoFiles } from "./hono-files.js";

/** Framework integration for the Hono Cloudflare Workers Golden Path. */
export const honoFrameworkPlugin: GeneratorPlugin = {
  descriptor: {
    id: "hono",
    version: "1.0.0",
    role: "framework",
    provides: [
      "language:typescript",
      "runtime:cloudflare-workers",
      "module:esm",
      "framework:hono-auth-handler",
      "runtime:cloudflare-nodejs-compat",
    ],
    dependencies: {
      hono: "^4.7.2",
      "@hono/zod-validator": "^0.4.3",
    },
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
  contribute: generateHonoFiles,
};
