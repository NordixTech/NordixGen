/** Internal stack versions: runtime and tooling are distinct; no selector or version solver. */
export const WORKSPACE_TOOLING = Object.freeze({
  node: ">=24.22.1",
  packageManager: "pnpm@10.5.2",
  overrides: Object.freeze({
    esbuild: "0.28.2",
    zod: "4.6.7",
    "body-parser": "2.4.0",
    "drizzle-kit>@esbuild-kit/esm-loader": "-",
  }),
});
export const BACKEND_STACK = Object.freeze({
  runtime: Object.freeze({
    hono: "^4.13.14",
    "@hono/node-server": "2.1.5",
    "@hono/zod-validator": "^0.9.1",
    zod: "4.6.7",
  }),
  persistence: Object.freeze({
    "drizzle-orm": "0.45.4",
    "@neondatabase/serverless": "^0.10.4",
    "@faker-js/faker": "10.6.0",
  }),
  identity: Object.freeze({
    "better-auth": "1.7.13",
    "@better-auth/drizzle-adapter": "1.7.13",
    nodemailer: "10.1.7",
  }),
  tooling: Object.freeze({
    typescript: "^5.8.2",
    "@types/node": "^24.0.0",
    tsx: "^4.19.3",
    esbuild: "0.28.2",
  }),
  databaseTooling: Object.freeze({ "drizzle-kit": "0.31.11" }),
});
export function backendDependencies(database: boolean, identity: boolean) {
  return {
    runtimeDependencies: {
      ...BACKEND_STACK.runtime,
      ...(database ? BACKEND_STACK.persistence : {}),
      ...(identity ? BACKEND_STACK.identity : {}),
    },
    developmentDependencies: {
      ...BACKEND_STACK.tooling,
      ...(database ? BACKEND_STACK.databaseTooling : {}),
      ...(identity ? { "@types/nodemailer": "8.0.2" } : {}),
    },
  };
}
