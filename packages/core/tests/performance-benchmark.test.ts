import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import * as authAdapter from "@better-auth/drizzle-adapter";
import * as validator from "@hono/zod-validator";
import * as neon from "@neondatabase/serverless";
import * as betterAuth from "better-auth";
import * as authApi from "better-auth/api";
import * as authPlugins from "better-auth/plugins";
import * as orm from "drizzle-orm";
import * as neonOrm from "drizzle-orm/neon-http";
import * as migrator from "drizzle-orm/neon-http/migrator";
import * as transactions from "drizzle-orm/neon-serverless";
import * as pg from "drizzle-orm/pg-core";
import * as hono from "hono";
import * as cors from "hono/cors";
import * as exception from "hono/http-exception";
import { describe, expect, it } from "vitest";
import * as zod from "zod";
import { parseNordixYaml } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

type Metric = {
  p50: number;
  p95: number;
  p99: number;
  requestsPerSecond: number;
  errors: number;
  requests: number;
  concurrency: number;
};
async function measure(
  requests: number,
  concurrency: number,
  run: (index: number) => Promise<void>,
): Promise<Metric> {
  let next = 0;
  let errors = 0;
  const durations: number[] = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < requests) {
        const index = next++;
        const start = performance.now();
        try {
          await run(index);
        } catch (error) {
          errors++;
          console.error(error);
        }
        durations.push(performance.now() - start);
      }
    }),
  );
  const elapsed = performance.now() - started;
  durations.sort((a, b) => a - b);
  const percentile = (p: number) =>
    Number(
      durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)].toFixed(3),
    );
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    requestsPerSecond: Number((requests / (elapsed / 1000)).toFixed(2)),
    errors,
    requests,
    concurrency,
  };
}

describe.skipIf(process.env.NORDIXGEN_BENCHMARK !== "1")(
  "reproducible scoped authorization performance",
  () => {
    it("compares global single with organization single/multiple under 20–50 concurrent users", async () => {
      const databaseUrl = process.env.NORDIXGEN_TEST_DATABASE_URL;
      if (!databaseUrl) throw Error("Explicit isolated database URL required");
      const parsedUrl = new URL(databaseUrl);
      if (
        parsedUrl.hostname !== "db.localtest.me" ||
        parsedUrl.username !== "nordixgen_test" ||
        parsedUrl.pathname !== "/nordixgen_test"
      )
        throw Error("Refusing to reset a non-test database");
      const port = process.env.NORDIXGEN_TEST_PROXY_PORT ?? "14444";
      if (!/^\d{4,5}$/.test(port)) throw Error("Invalid test proxy port");
      const previous = {
        url: process.env.DATABASE_URL,
        proxy: process.env.NEON_HTTP_PROXY_URL,
        endpoint: neon.neonConfig.fetchEndpoint,
        fetch: neon.neonConfig.fetchFunction,
      };
      process.env.DATABASE_URL = databaseUrl;
      process.env.NEON_HTTP_PROXY_URL = `http://127.0.0.1:${port}/sql`;
      neon.neonConfig.fetchEndpoint = `http://127.0.0.1:${port}/sql`;
      neon.neonConfig.fetchFunction = fetch;
      const sql = neon.neon(databaseUrl);
      const parent = url.fileURLToPath(new URL("../", import.meta.url));
      const benchmark = {
        startedAt: new Date().toISOString(),
        node: process.version,
        database: "PostgreSQL via local Neon HTTP/WebSocket proxy",
        workload: { users: 1001, organizations: 50, businessRows: 10000 },
        scenarios: {} as Record<string, Record<string, Metric>>,
      };
      const tasks: Promise<unknown>[] = [];
      let directory = "";
      try {
        for (const scenario of [
          "global-single",
          "organization-single",
          "organization-multiple",
        ] as const) {
          console.log("Benchmark scenario:", scenario);
          await sql("DROP SCHEMA IF EXISTS drizzle CASCADE");
          await sql("DROP SCHEMA public CASCADE");
          await sql("CREATE SCHEMA public");
          const input = parseNordixYaml(
            await readFile(
              new URL("../../../examples/performance/project.yaml", import.meta.url),
              "utf8",
            ),
          );
          if (!input.success) throw Error(JSON.stringify(input.diagnostics));
          const config = input.config;
          const authorization = config.backends[0].authorization;
          const authentication = config.backends[0].authentication;
          if (!authorization || !authentication)
            throw Error("Performance fixture requires identity and authorization");
          const scoped = scenario !== "global-single";
          const multiple = scenario === "organization-multiple";
          // Both scenarios use identical workloads, runtime, PostgreSQL and network path.
          authentication.methods = ["email-password"];
          authentication.features = [];
          if (!scoped) {
            for (const [role, permissions] of Object.entries(
              authorization.organizations.rolePermissions,
            ))
              authorization.global.rolePermissions[role] = [
                ...new Set([...(authorization.global.rolePermissions[role] ?? []), ...permissions]),
              ];
            authorization.organizations.enabled = false;
            authorization.global.mode = "single";
            for (const endpoint of config.endpoints) endpoint.scope = "global";
          } else {
            authorization.global.mode = multiple ? "multiple" : "single";
            authorization.organizations.mode = multiple ? "multiple" : "single";
          }
          const output = generateBackend(resolvedFixture(config), "api");
          directory = await mkdtemp(path.join(parent, ".nordixgen-contract-types-benchmark-"));
          if (
            !path
              .resolve(directory)
              .startsWith(path.join(parent, ".nordixgen-contract-types-benchmark-"))
          )
            throw Error("Unsafe benchmark output");
          await output.virtualFileSystem.emit(directory);
          const appDirectory = path.join(directory, "apps/api");
          await writeFile(path.join(appDirectory, "package.json"), '{"type":"module"}');
          const migration = spawnSync(
            process.execPath,
            [
              path.join(parent, "node_modules/drizzle-kit/bin.cjs"),
              "generate",
              "--config",
              path.join(appDirectory, "drizzle.config.ts"),
            ],
            { cwd: appDirectory, encoding: "utf8", env: process.env },
          );
          if (migration.status !== 0) throw Error(`${migration.stdout}\n${migration.stderr}`);
          const root = "apps/api/src";
          const files = output.virtualFileSystem.snapshot();
          const live = generatedRuntime(files, {
            zod,
            hono,
            "hono/cors": cors,
            "hono/http-exception": exception,
            "@hono/zod-validator": validator,
            "drizzle-orm": orm,
            "drizzle-orm/pg-core": pg,
            "drizzle-orm/neon-http": neonOrm,
            "drizzle-orm/neon-http/migrator": migrator,
            "drizzle-orm/neon-serverless": transactions,
            "@neondatabase/serverless": neon,
            "better-auth": betterAuth,
            "better-auth/api": authApi,
            "better-auth/plugins": authPlugins,
            "@better-auth/drizzle-adapter": authAdapter,
            "node:path": path,
            "node:url": url,
            [`${root}/platform/auth/delivery.ts`]: {
              assertEmailDelivery: () => {},
              sendAuthEmail: async () => {},
            },
          });
          await (
            live(`${root}/platform/database/migrate.ts`).runMigrations as (
              options: unknown,
            ) => Promise<void>
          )({ directory: path.join(appDirectory, "drizzle") });
          const app = live(`${root}/index.ts`).default as hono.Hono;
          const env = {
            DOCUMENTS: {},
            ASSETS: {},
            DATABASE_URL: databaseUrl,
            BETTER_AUTH_URL: "http://localhost:8787",
            BETTER_AUTH_SECRET: "benchmark-only-secret-with-at-least-32-characters",
            AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
          };
          const request = (route: string, cookie = "", body?: unknown, orgId?: string) =>
            app.request(
              `http://localhost:8787${route}`,
              {
                method: body === undefined ? "GET" : "POST",
                headers: {
                  cookie,
                  origin: "http://localhost:3000",
                  "content-type": "application/json",
                  ...(orgId ? { "x-organization-id": orgId } : {}),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              },
              env,
              {
                waitUntil: (task) => {
                  tasks.push(task);
                },
                passThroughOnException: () => {},
                props: {},
              },
            );
          const password = "Benchmark-Only-12!";
          const registered = await request("/api/auth/sign-up/email", "", {
            name: "Benchmark",
            email: "benchmark@example.test",
            password,
          });
          expect(registered.status, await registered.clone().text()).toBe(200);
          const userId = (await registered.json()).user.id as string;
          const cookie = registered.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; ");
          await sql(
            `INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at${multiple ? "" : ",role"}) SELECT 'bench-user-'||g,'User '||g,'bench-'||g||'@example.test',true,now(),now()${multiple ? "" : ",'manager'"} FROM generate_series(1,1000)g`,
          );
          await sql(
            "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) SELECT 'bench-account-'||g,'bench-user-'||g,'credential','bench-user-'||g,(SELECT password FROM account WHERE user_id=$1 AND provider_id='credential'),now(),now() FROM generate_series(1,1000)g",
            [userId],
          );
          if (multiple) {
            await sql(
              "INSERT INTO auth_user_roles(user_id,role_id) SELECT u.id,r.role FROM auth_user u CROSS JOIN(VALUES('manager'),('operator'))r(role) ON CONFLICT DO NOTHING",
            );
          } else await sql("UPDATE auth_user SET role='manager'");
          if (scoped) {
            await sql(
              "INSERT INTO organization(id,name,slug) SELECT 'bench-org-'||g,'Organization '||g,'bench-org-'||g FROM generate_series(1,50)g",
            );
            const policy = authorization.organizations;
            const roles = policy.roles.map((name) => ({
              name,
              permissions: name === policy.ownerRole ? ["*"] : (policy.rolePermissions[name] ?? []),
            }));
            await sql(
              "INSERT INTO auth_org_roles(id,organization_id,name,is_system) SELECT o.id||':'||(r->>'name'),o.id,r->>'name',(r->>'name') IN ($2,$3) FROM organization o CROSS JOIN jsonb_array_elements($1::jsonb)r",
              [JSON.stringify(roles), policy.ownerRole, policy.defaultRole],
            );
            await sql(
              "INSERT INTO auth_org_role_permissions(id,org_role_id,permission) SELECT gen_random_uuid()::text,o.id||':'||(r->>'name'),p FROM organization o CROSS JOIN jsonb_array_elements($1::jsonb)r CROSS JOIN jsonb_array_elements_text(r->'permissions')p",
              [JSON.stringify(roles)],
            );
            await sql(
              "INSERT INTO member(id,organization_id,user_id,role) SELECT 'bench-member-'||g,'bench-org-'||((g-1)%50+1),'bench-user-'||g,'bench-org-'||((g-1)%50+1)||CASE WHEN g<=50 THEN ':owner' ELSE ':manager' END FROM generate_series(1,1000)g",
            );
            await sql(
              "INSERT INTO member(id,organization_id,user_id,role) VALUES('bench-primary-member','bench-org-1',$1,'bench-org-1:manager')",
              [userId],
            );
            if (multiple)
              await sql(
                "INSERT INTO auth_member_roles(member_id,role_id,organization_id) SELECT id,role,organization_id FROM member UNION ALL SELECT id,organization_id||':operator',organization_id FROM member WHERE role NOT LIKE '%:owner'",
              );
          }
          await sql(
            `INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at${scoped ? ",active_organization_id" : ""}) SELECT 'bench-session-'||g,'bench-token-'||g,'bench-user-'||g,now()+interval '1 day',now(),now()${scoped ? ",'bench-org-'||((g-1)%50+1)" : ""} FROM generate_series(1,1000)g`,
          );
          const orgColumn = scoped ? ",organization_id" : "";
          const orgValue = scoped ? ",o.id" : "";
          const from =
            " FROM generate_series(1,50)g CROSS JOIN generate_series(1,25)n CROSS JOIN LATERAL(SELECT 'bench-org-'||g AS id)o";
          const parentId = (table: string) =>
            `(SELECT id FROM "${table}"${scoped ? " WHERE organization_id=o.id" : ""} LIMIT 1)`;
          for (const [table, columns, values] of [
            ["customer", "name,email", "'Customer',g||'-'||n||'@fixture.test'"],
            ["address", "street,city,customer_id", `'Street','City',${parentId("customer")}`],
            ["category", "name", "'Category'"],
            [
              "product",
              "name,sku,price,stock,category_id",
              `'Product',g||'-'||n,10,100,${parentId("category")}`,
            ],
            [
              "order",
              "reference,status,total,customer_id",
              `g||'-'||n,'pending',20,${parentId("customer")}`,
            ],
            [
              "order_item",
              "quantity,unit_price,order_id,product_id",
              `2,10,${parentId("order")},${parentId("product")}`,
            ],
            ["payment", "amount,status,order_id", `20,'pending',${parentId("order")}`],
            [
              "shipment",
              "tracking_code,status,order_id",
              `g||'-'||n,'pending',${parentId("order")}`,
            ],
          ])
            await sql(
              `INSERT INTO "${table}"(id,${columns}${orgColumn}) SELECT gen_random_uuid(),${values}${orgValue}${from}`,
            );
          await sql("ANALYZE");
          const orgId = scoped ? "bench-org-1" : undefined;
          const route = config.endpoints.find(
            (endpoint) =>
              endpoint.entity === "Order" &&
              endpoint.method === "GET" &&
              endpoint.joins.length &&
              endpoint.pagination,
          )?.path;
          if (!route || route.includes("{"))
            throw Error("Performance fixture requires a paginated Order join query");
          // Sign only this isolated fixture's preseeded session tokens with its test secret.
          // Better Auth still verifies signatures, expiry and the persisted user/session per request.
          const cookies = Array.from({ length: 1000 }, (_, index) => {
            const token = `bench-token-${index + 1}`;
            return `better-auth.session_token=${encodeURIComponent(
              `${token}.${createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64")}`,
            )}`;
          });
          const checked = async (route: string, body?: unknown, index?: number) => {
            const response = await request(
              route,
              index === undefined ? cookie : cookies[index % 1000],
              body,
              index === undefined ? orgId : scoped ? `bench-org-${(index % 50) + 1}` : undefined,
            );
            if (!response.ok) throw Error(`${route}:${response.status}:${await response.text()}`);
            await response.arrayBuffer();
          };
          const repository = (
            live(`${root}/platform/authorization/repository.ts`).createIamRepository as (
              db: unknown,
            ) => { principal(id: string, org?: string): Promise<unknown> }
          )(
            (
              live(`${root}/platform/database/drizzle-database.ts`).createDrizzleDatabase as (
                url: string,
              ) => unknown
            )(databaseUrl),
          );
          for (let i = 0; i < 20; i++) {
            await checked("/api/auth/iam/me");
            await checked(route);
          }
          const metrics: Record<string, Metric> = {};
          metrics.principal = await measure(500, 20, async (i) => {
            const principal = await repository.principal(
              `bench-user-${(i % 1000) + 1}`,
              scoped ? `bench-org-${(i % 50) + 1}` : undefined,
            );
            if (!principal) throw Error("Missing principal");
          });
          metrics.session = await measure(200, 20, (i) =>
            checked("/api/auth/get-session", undefined, i),
          );
          metrics.iam = await measure(300, 20, (i) => checked("/api/auth/iam/me", undefined, i));
          metrics.protectedApi20 = await measure(300, 20, (i) => checked(route, undefined, i));
          metrics.protectedApi50 = await measure(300, 50, (i) => checked(route, undefined, i));
          metrics.signIn = await measure(40, 20, (i) =>
            checked("/api/auth/sign-in/email", {
              email: `bench-${i + 1}@example.test`,
              password,
            }),
          );
          if (scoped) {
            const organizations = live(`${root}/platform/authorization/organizations.ts`)
              .organizationRepository as (url: string) => {
              change(org: string, actor: string, input: unknown): Promise<unknown>;
            };
            const store = organizations(databaseUrl);
            metrics.organizationMutations = await measure(100, 20, async (i) => {
              const index = (i % 50) + 1;
              await store.change(`bench-org-${index}`, `bench-user-${index}`, {
                kind: "member",
                id: `bench-member-${index + 50}`,
                roles: [
                  `bench-org-${index}:manager`,
                  ...(multiple ? [`bench-org-${index}:operator`] : []),
                ],
              });
            });
          }
          if (multiple) {
            const mutations = live(`${root}/platform/authorization/mutations.ts`) as {
              changeAccess(
                url: string,
                input: unknown,
                defaultRole: string,
                adminRole: string,
              ): Promise<{ code: string }>;
            };
            await sql(
              "INSERT INTO auth_user_roles(user_id,role_id) VALUES($1,'admin') ON CONFLICT DO NOTHING",
              [userId],
            );
            metrics.globalMutations = await measure(100, 20, async (i) => {
              const result = await mutations.changeAccess(
                databaseUrl,
                {
                  kind: "user",
                  id: `bench-user-${i + 100}`,
                  actor: userId,
                  roles: ["manager", "operator"],
                },
                "guest",
                "admin",
              );
              if (result.code !== "ok") throw Error(result.code);
            });
          }
          const policy = live(`${root}/platform/authorization/policy.ts`) as {
            isAuthorized(principal: unknown, requirements: unknown): boolean;
          };
          const principal = {
            organizationId: orgId,
            globalPermissionSet: new Set(["order:read"]),
            organizationPermissionSet: new Set(["order:read"]),
          };
          const started = performance.now();
          for (let i = 0; i < 100000; i++)
            if (
              !policy.isAuthorized(principal, {
                scope: scoped ? "organization" : "global",
                permissions: ["order:read"],
              })
            )
              throw Error("Unexpected permission denial");
          metrics.setLookup = {
            p50: (performance.now() - started) / 100000,
            p95: 0,
            p99: 0,
            requestsPerSecond: 0,
            errors: 0,
            requests: 100000,
            concurrency: 1,
          };
          benchmark.scenarios[scenario] = metrics;
          console.log(JSON.stringify({ scenario, metrics }));
          for (const metric of Object.values(metrics)) expect(metric.errors).toBe(0);
          while (tasks.length) await Promise.all(tasks.splice(0));
          await rm(directory, { recursive: true, force: true });
          directory = "";
        }
        const outputPath = url.fileURLToPath(
          new URL("../../../tmp/authorization-128/benchmark-results.json", import.meta.url),
        );
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify(benchmark, null, 2));
        console.log("Performance scorecard:", outputPath);
        for (const scenario of ["organization-single", "organization-multiple"])
          for (const name of ["principal", "iam"]) {
            const baseline = benchmark.scenarios["global-single"][name];
            const current = benchmark.scenarios[scenario][name];
            expect(
              current.p50 - baseline.p50,
              `${scenario} ${name} median overhead`,
            ).toBeLessThanOrEqual(20);
            expect(
              current.p95 - baseline.p95,
              `${scenario} ${name} p95 overhead`,
            ).toBeLessThanOrEqual(20);
          }
      } finally {
        while (tasks.length) await Promise.all(tasks.splice(0));
        if (directory) await rm(directory, { recursive: true, force: true });
        neon.neonConfig.fetchEndpoint = previous.endpoint;
        neon.neonConfig.fetchFunction = previous.fetch;
        if (previous.url === undefined) Reflect.deleteProperty(process.env, "DATABASE_URL");
        else process.env.DATABASE_URL = previous.url;
        if (previous.proxy === undefined)
          Reflect.deleteProperty(process.env, "NEON_HTTP_PROXY_URL");
        else process.env.NEON_HTTP_PROXY_URL = previous.proxy;
      }
    }, 600000);
  },
);
