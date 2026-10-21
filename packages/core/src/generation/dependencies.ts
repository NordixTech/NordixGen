/** Internal stack versions: runtime and tooling are distinct; no selector or version solver. */
export const WORKSPACE_TOOLING = Object.freeze({ node: ">=24.0.0", packageManager: "pnpm@10.5.2" });
export const BACKEND_STACK = Object.freeze({
  runtime: Object.freeze({
    hono: "^4.7.2",
    "@hono/node-server": "2.1.5",
    "@hono/zod-validator": "^0.4.3",
    zod: "^3.24.2",
  }),
  persistence: Object.freeze({
    "drizzle-orm": "0.45.4",
    "@neondatabase/serverless": "^0.10.4",
    "@faker-js/faker": "9.9.0",
  }),
  identity: Object.freeze({
    "better-auth": "1.7.10",
    "@better-auth/drizzle-adapter": "1.7.10",
    nodemailer: "10.1.7",
  }),
  tooling: Object.freeze({
    typescript: "^5.8.2",
    "@types/node": "^24.0.0",
    tsx: "^4.19.3",
    esbuild: "0.25.12",
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
