import { posix } from "node:path";
import type { FrontendPaths } from "../frontend-contracts.js";
export function frontendPaths(applicationRoot: string): FrontendPaths {
  return {
    applicationRoot,
    codeRoot: posix.join(applicationRoot, "src"),
    scaffold: {
      executable: "pnpm",
      argumentsBeforeTarget: ["dlx", "create-next-app@16.4.3"],
      argumentsAfterTarget: [
        "--yes",
        "--typescript",
        "--app",
        "--src-dir",
        "--tailwind",
        "--use-pnpm",
        "--import-alias",
        "@/*",
        "--skip-install",
        "--disable-git",
      ],
    },
  };
}
