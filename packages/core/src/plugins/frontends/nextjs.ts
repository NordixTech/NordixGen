import type { FrontendGeneratorPlugin } from "../frontend-contracts.js";

export const nextjsFrontendPlugin: FrontendGeneratorPlugin = {
  descriptor: {
    id: "nextjs",
    version: "1.0.0",
    role: "framework",
    provides: ["framework:nextjs", "framework:react", "runtime:nodejs"],
  },
  createFrameworkContext(frontend) {
    const styling = frontend.styling ?? "tailwind";
    return {
      pluginId: "nextjs",
      applicationRoot: frontend.path,
      codeRoot: frontend.path === "." ? "src" : `${frontend.path}/src`,
      language: "typescript",
      runtime: "nodejs",
      moduleSystem: "esm",
      scaffold: {
        executable: "pnpm",
        argumentsBeforeTarget: ["dlx", "create-next-app@15.5.26"],
        argumentsAfterTarget: [
          "--yes",
          "--typescript",
          "--app",
          "--src-dir",
          styling === "tailwind" ? "--tailwind" : "--no-tailwind",
          "--use-pnpm",
          "--disable-git",
        ],
      },
      conventions: {
        router: "app",
        importAlias: "@/*",
        styling,
        ui: frontend.ui ?? "native",
      },
    };
  },
  contribute: () => [],
};
