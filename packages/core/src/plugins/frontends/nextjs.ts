import { posix } from "node:path";
import type { FrontendPaths } from "../frontend-contracts.js";
export function frontendPaths(applicationRoot: string): FrontendPaths {
  return {
    applicationRoot,
    codeRoot: posix.join(applicationRoot, "src"),
    scaffold: {
      executable: "pnpm",
      argumentsBeforeTarget: ["dlx", "create-next-app@15.5.26"],
      argumentsAfterTarget: [
        "--yes",
        "--typescript",
        "--app",
        "--src-dir",
        "--tailwind",
        "--use-pnpm",
        "--disable-git",
      ],
    },
  };
}
