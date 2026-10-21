import { posix } from "node:path";
import type { BackendPaths } from "../contracts.js";
export function backendPaths(applicationRoot: string): BackendPaths {
  const codeRoot = posix.join(applicationRoot, "src");
  return {
    applicationRoot,
    codeRoot,
    entryPoints: { worker: posix.join(codeRoot, "index.ts") },
    scaffold: {
      executable: "pnpm",
      argumentsBeforeTarget: ["create", "hono@0.19.4"],
      argumentsAfterTarget: ["--template", "cloudflare-workers", "--pm", "pnpm", "--install"],
    },
  };
}
