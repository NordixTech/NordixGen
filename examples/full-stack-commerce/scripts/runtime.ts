// Acceptance-only Node adapter. Copied beside the freshly generated backend's package.json.
// Generated business/identity handlers are imported unchanged. No production secrets/data are used.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { neon, neonConfig } from "@neondatabase/serverless";
import app from "./src/index.js";
import { PreviewCustomer } from "./src/modules/billing/application/preview-customer.js";
import { createOperationBoundary } from "./src/platform/application/access.js";
import type { OperationContext } from "./src/platform/application/contracts.js";
import { createAuth } from "./src/platform/auth/auth.js";
import { createIamRepository } from "./src/platform/authorization/repository.js";
import { composeModules } from "./src/platform/database/create-route-dependencies.js";
import { createDrizzleDatabase } from "./src/platform/database/drizzle-database.js";
import { runMigrations } from "./src/platform/database/migrate.js";
import { seedDatabase } from "./src/platform/database/seed.js";

const state = JSON.parse(await readFile(process.env.NORDIXGEN_ACCEPTANCE_STATE ?? "", "utf8"));
assert.match(state.id, /^[a-f0-9]{16}$/);
assert.equal(state.databaseName, `nordixgen_acceptance_${state.id}`);
for (const port of [state.apiPort, state.webPort, state.proxyPort])
  assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const connection = `postgresql://nordixgen_test:acceptance-only@db.localtest.me:5432/${state.databaseName}`;
// The supported Neon HTTP local proxy topology is selected only in this test adapter.
// createDrizzleDatabase sets the default local endpoint (4444); forward it to our own random port.
neonConfig.fetchFunction = (
  target: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => {
  const endpoint = new URL(String(target));
  assert.equal(endpoint.hostname, "127.0.0.1");
  assert.ok(["4444", String(state.proxyPort)].includes(endpoint.port));
  endpoint.port = String(state.proxyPort);
  return fetch(endpoint, init);
};
neonConfig.fetchEndpoint = `http://127.0.0.1:${state.proxyPort}/sql`;
process.env.DATABASE_URL = connection;
process.env.NEON_HTTP_PROXY_URL = `http://127.0.0.1:${state.proxyPort}/sql`;
const sql = neon(connection);
const environment = {
  NODE_ENV: "test",
  DATABASE_URL: connection,
  BETTER_AUTH_SECRET: state.secret,
  BETTER_AUTH_URL: `http://localhost:${state.apiPort}`,
  AUTH_TRUSTED_ORIGINS: `http://localhost:${state.webPort}`,
};
const executionContext = {
  waitUntil: (_promise: Promise<unknown>) => {},
  passThroughOnException: () => {},
  props: {},
};
const dispatch = (request: Request) => app.fetch(request, environment, executionContext);

if (process.argv[2] === "prepare") {
  // Fresh database owned by this run: no DROP/reset operation exists in this runner.
  await runMigrations();
  const seeds = await seedDatabase({ seed: 19 });
  assert.ok(
    seeds.Customer.length > 0 && seeds.CustomerAddress.length > 0 && seeds.Invoice.length > 0,
  );
  const tables = await sql("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const table of [
    "customer",
    "customer_address",
    "invoice",
    "auth_user",
    "session",
    "account",
    "verification",
  ])
    assert.ok(
      tables.some((row) => row.tablename === table),
      `Missing ${table}`,
    );
  const identities: Record<string, string> = {};
  for (const role of ["admin", "viewer", "accountant", "outsider"]) {
    const email = `${role}@acceptance.example.test`;
    const response = await dispatch(
      new Request(`${environment.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: environment.AUTH_TRUSTED_ORIGINS },
        body: JSON.stringify({
          name: `Acceptance ${role}`,
          email,
          password: "acceptance-local-password-2026",
          role: "admin",
        }),
      }),
    );
    assert.equal(response.status, 200, `Signup ${role} failed`);
    const value = (await response.json()) as { user: { id: string; role: string } };
    assert.equal(
      value.user.role,
      "viewer",
      "Signup must not accept caller-controlled privilege escalation",
    );
    // Explicit acceptance provisioning, not a generated signup feature or a seed of auth accounts.
    await sql("UPDATE auth_user SET role=$1 WHERE id=$2", [role, value.user.id]);
    identities[role] = value.user.id;
  }
  const foreignKeys = await sql(
    "SELECT count(*)::integer AS count FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public'",
  );
  assert.ok(foreignKeys[0].count >= 3);
  const related = await sql(
    "SELECT count(*)::integer AS count FROM customer_address a JOIN customer c ON c.id=a.customer_id",
  );
  assert.ok(related[0].count > 0, "The owned customer relation must contain real persisted rows");
  await writeFile(
    new URL("./acceptance-persistence.json", import.meta.url),
    JSON.stringify(
      {
        tables: tables.map((row) => row.tablename),
        seeds: Object.fromEntries(Object.entries(seeds).map(([name, rows]) => [name, rows.length])),
        customerId: seeds.Customer[0].id,
        identities,
      },
      null,
      2,
    ),
  );
  console.log(
    "Migrations, both module seeds, relation, identity schema and least-privilege signup verified.",
  );
} else if (process.argv[2] === "expire-accountant") {
  await sql(
    "UPDATE session SET expires_at=NOW()-INTERVAL '1 hour' WHERE user_id IN (SELECT id FROM auth_user WHERE email=$1)",
    ["accountant@acceptance.example.test"],
  );
  console.log("Only this run's acceptance accountant sessions expired.");
} else if (process.argv[2] === "serve") {
  const server = serve(
    {
      hostname: "127.0.0.1",
      port: state.apiPort,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/__acceptance/")) {
          // Deliberately authored acceptance route; never represented as a generated business endpoint.
          const boundary = createOperationBoundary(async (headers) => {
            const session = await createAuth(environment, executionContext).api.getSession({
              headers,
            });
            return session
              ? ((await createIamRepository(createDrizzleDatabase(connection)).principal(
                  session.user.id,
                )) ?? null)
              : null;
          });
          const modules = composeModules(createDrizzleDatabase(connection), boundary.authorize);
          const preview = new PreviewCustomer(modules.billing.dependencies, boundary.authorize);
          const input = { customerId: url.searchParams.get("customerId") ?? "" };
          if (url.pathname === "/__acceptance/context-probes") {
            const forged = {
              principal: { id: "fabricated", role: "admin" },
            } as unknown as OperationContext;
            const rejected = await preview.execute(input, forged);
            let revoked: OperationContext | undefined;
            await boundary.run(request.headers, async (context) => {
              revoked = context;
            });
            assert.ok(revoked);
            const expired = await preview.execute(input, revoked);
            return Response.json({ forged: rejected, revoked: expired });
          }
          if (url.pathname !== "/__acceptance/preview-customer")
            return new Response(null, { status: 404 });
          const result = await boundary.run(request.headers, (context) =>
            preview.execute(input, context),
          );
          const statuses = {
            validation: 400,
            unauthorized: 401,
            forbidden: 403,
            not_found: 404,
            conflict: 409,
            unexpected: 500,
          };
          return Response.json(result, { status: result.ok ? 200 : statuses[result.error.code] });
        }
        return dispatch(request);
      },
    },
    () => console.log(`Acceptance backend ready on ${state.apiPort}`),
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => server.close(() => process.exit(0)));
} else throw Error("Use prepare or serve; acceptance state is mandatory.");
