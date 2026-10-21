import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { GeneratedFile } from "../plugins/contracts.js";
import { storageProxySource } from "./storage-proxy.js";

/** Stable across account changes, unique across generated projects and applications. */
export function cloudflareWorkerName(project: string, app: string): string {
  const name = `${project}-${app}`;
  return name.length <= 48
    ? name
    : `${name.slice(0, 37)}-${createHash("sha256").update(name).digest("hex").slice(0, 10)}`;
}
export function cloudflareConfiguration(
  project: string,
  app: string,
  frontend = false,
  connections: readonly string[] = [],
  storage: readonly string[] = [],
) {
  const name = cloudflareWorkerName(project, app);
  const environment = (environment: string) => ({
    ...(!frontend ? { placement: { mode: "smart" } } : {}),
    ...(!frontend ? { vars: { NODE_ENV: "production" } } : {}),
    name: `${name}-${environment}`,
    workers_dev: frontend,
    preview_urls: false,
    ...(!frontend && storage.length
      ? {
          r2_buckets: storage.map((key) => ({
            binding: key.toUpperCase(),
            bucket_name: r2BucketName(project, environment, key),
          })),
        }
      : {}),
    ...(frontend
      ? {
          assets: { directory: ".open-next/assets", binding: "ASSETS" },
          services: [
            { binding: "WORKER_SELF_REFERENCE", service: `${name}-${environment}` },
            ...connections.map((backend) => ({
              binding: serviceBinding(backend),
              service: `${cloudflareWorkerName(project, backend)}-${environment}`,
            })),
          ],
        }
      : {}),
  });
  return {
    ...(!frontend ? { placement: { mode: "smart" } } : {}),
    name,
    main: frontend ? ".open-next/worker.js" : "src/index.ts",
    compatibility_date: "2026-10-01",
    workers_dev: frontend,
    preview_urls: false,
    ...(!frontend && storage.length
      ? {
          r2_buckets: storage.map((key) => ({
            binding: key.toUpperCase(),
            bucket_name: r2BucketName(project, "staging", key),
          })),
        }
      : {}),
    compatibility_flags: ["nodejs_compat", ...(frontend ? ["global_fetch_strictly_public"] : [])],
    ...(frontend
      ? {
          assets: { directory: ".open-next/assets", binding: "ASSETS" },
          services: [
            { binding: "WORKER_SELF_REFERENCE", service: name },
            ...connections.map((backend) => ({
              binding: serviceBinding(backend),
              service: cloudflareWorkerName(project, backend),
            })),
          ],
        }
      : {}),
    env: { staging: environment("staging"), production: environment("production") },
  };
}
export function frontendCloudflareFiles(
  project: string,
  app: string,
  root: string,
  connections: readonly string[] = [],
  storageBackends: readonly string[] = [],
): GeneratedFile[] {
  const configuration = cloudflareConfiguration(project, app, true, connections);
  if (storageBackends.length) configuration.main = "worker.ts";
  return [
    {
      path: posix.join(root, "wrangler.jsonc"),
      content: `${JSON.stringify(configuration, null, 2)}\n`,
    },
    {
      path: posix.join(root, "open-next.config.ts"),
      content:
        'import { defineCloudflareConfig } from "@opennextjs/cloudflare";\nexport default defineCloudflareConfig({});\n',
    },
    ...(storageBackends.length
      ? [
          {
            path: posix.join(root, "storage-proxy.ts"),
            content: storageProxySource,
          },
          {
            path: posix.join(root, "worker.ts"),
            content: `// @ts-ignore OpenNext emits this module during the production build.\nimport next from "./.open-next/worker.js";\n// @ts-ignore Preserve any durable object exports supplied by OpenNext.\nexport * from "./.open-next/worker.js";\nimport {proxyStorageDownload} from "./storage-proxy";\nconst bindings:Readonly<Record<string,string>>=${JSON.stringify(Object.fromEntries(storageBackends.map((backend) => [backend, serviceBinding(backend)])))};\nexport default {async fetch(request:Request,env:Record<string,unknown>,context:unknown):Promise<Response>{\n return await proxyStorageDownload(request,env,bindings)??next.fetch(request,env,context);\n}};\n`,
          },
        ]
      : []),
  ];
}
export function serviceBinding(backend: string) {
  return `BACKEND_${backend.toUpperCase().replaceAll("-", "_")}`;
}
export function r2BucketName(project: string, environment: string, key: string) {
  const name = `${project}-${environment}-${key.toLowerCase().replaceAll("_", "-")}`;
  return name.length <= 63
    ? name
    : `${name.slice(0, 52)}-${createHash("sha256").update(name).digest("hex").slice(0, 10)}`;
}
