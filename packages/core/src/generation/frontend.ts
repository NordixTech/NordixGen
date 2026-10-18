import { buildFrontendApiContract } from "../plugins/frontend-api-contract.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
import { generateFrontendAuthFiles } from "../plugins/frontends/better-auth-client.js";
import { generateClientStateFiles } from "../plugins/frontends/client-state.js";
import { generateFeatureScreenFiles } from "../plugins/frontends/feature-screens.js";
import { generateUiFiles } from "../plugins/frontends/native-ui.js";
import { frontendPaths } from "../plugins/frontends/nextjs.js";
import { generateFrontendShell } from "../plugins/frontends/root-shell.js";
import { generateQueryFiles } from "../plugins/frontends/server-state.js";
import { generateApiClientFiles } from "../plugins/frontends/typed-api-client.js";
import { generateTailwindFiles } from "../plugins/styling/tailwind.js";
import type { ResolvedProject } from "../project/types.js";
import { frontendView } from "../project/views.js";
import { collectFiles } from "./files.js";
export const FRONTEND_STACK = {
  runtime: {
    "@tanstack/react-query": "^5.80.7",
    zustand: "^5.0.8",
    zod: "^3.24.2",
    "react-hook-form": "^7.54.2",
    "@hookform/resolvers": "^3.10.0",
  },
  development: { tailwindcss: "^4.0.0", "@tailwindcss/postcss": "^4.0.0" },
  identity: { "better-auth": "^1.7.7" },
} as const;
export const FRONTEND_SCAFFOLD_OVERLAYS = [
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/globals.css",
  "postcss.config.mjs",
] as const;
export function frontendRenderContext(
  project: ResolvedProject,
  name: string,
): FrontendRenderContext {
  const frontend = frontendView(project, name);
  return {
    projectName: project.project.name,
    frontend,
    framework: frontendPaths(frontend.path),
    api: buildFrontendApiContract(project, name),
  };
}
export function generateFrontend(project: ResolvedProject, name: string) {
  const context = frontendRenderContext(project, name);
  const contributions = [
    { owner: "shell", files: generateFrontendShell(context) },
    { owner: "ui", files: generateUiFiles(context) },
    { owner: "tailwind", files: generateTailwindFiles(context) },
    { owner: "api", files: generateApiClientFiles(context) },
    { owner: "queries", files: generateQueryFiles(context) },
    { owner: "ui-state", files: generateClientStateFiles(context) },
    { owner: "screens", files: generateFeatureScreenFiles(context) },
    ...(context.api.authentication
      ? [{ owner: "identity", files: generateFrontendAuthFiles(context) }]
      : []),
  ];
  return {
    success: true as const,
    virtualFileSystem: collectFiles(context.frontend.path, contributions),
    frameworkContext: context.framework,
    runtimeDependencies: {
      ...FRONTEND_STACK.runtime,
      ...(context.api.authentication ? FRONTEND_STACK.identity : {}),
    },
    developmentDependencies: FRONTEND_STACK.development,
    diagnostics: [],
  };
}
