import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { GeneratedFile } from "../plugins/contracts.js";

/** Stable across account changes, unique across generated projects and applications. */
export function cloudflareWorkerName(project: string, app: string): string {
  const name = `${project}-${app}`;
  return name.length <= 48
    ? name
    : `${name.slice(0, 37)}-${createHash("sha256").update(name).digest("hex").slice(0, 10)}`;
}
export function cloudflareConfiguration(project: string, app: string, frontend = false) {
  const name = cloudflareWorkerName(project, app);
  const environment = (environment: string) => ({
    name: `${name}-${environment}`,
    workers_dev: true,
    ...(frontend
      ? {
          assets: { directory: ".open-next/assets", binding: "ASSETS" },
          services: [{ binding: "WORKER_SELF_REFERENCE", service: `${name}-${environment}` }],
        }
      : {}),
  });
  return {
    name,
    main: frontend ? ".open-next/worker.js" : "src/index.ts",
    compatibility_date: "2026-10-01",
    compatibility_flags: ["nodejs_compat", ...(frontend ? ["global_fetch_strictly_public"] : [])],
    ...(frontend
      ? {
          assets: { directory: ".open-next/assets", binding: "ASSETS" },
          services: [{ binding: "WORKER_SELF_REFERENCE", service: name }],
        }
      : {}),
    env: { staging: environment("staging"), production: environment("production") },
  };
}
export function frontendCloudflareFiles(
  project: string,
  app: string,
  root: string,
): GeneratedFile[] {
  return [
    {
      path: posix.join(root, "wrangler.jsonc"),
      content: `${JSON.stringify(cloudflareConfiguration(project, app, true), null, 2)}\n`,
    },
    {
      path: posix.join(root, "open-next.config.ts"),
      content:
        'import { defineCloudflareConfig } from "@opennextjs/cloudflare";\nexport default defineCloudflareConfig({});\n',
    },
  ];
}
