import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import * as authAdapter from "@better-auth/drizzle-adapter";
import * as faker from "@faker-js/faker";
import * as validator from "@hono/zod-validator";
import * as neon from "@neondatabase/serverless";
import * as betterAuth from "better-auth";
import * as orm from "drizzle-orm";
import * as neonOrm from "drizzle-orm/neon-http";
import * as migrator from "drizzle-orm/neon-http/migrator";
import * as pg from "drizzle-orm/pg-core";
import * as hono from "hono";
import * as cors from "hono/cors";
import * as httpException from "hono/http-exception";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as zod from "zod";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { ACCOUNT_POLICY } from "../src/project/account-policy.js";
import { resolvedFixture } from "./fixtures.js";
import { frontendRuntime } from "./frontend-runtime.js";
import { generatedRuntime } from "./generated-runtime.js";
import { constrainedPersistenceFixture, persistenceFixture } from "./persistence-fixture.js";
const databaseUrl = process.env.NORDIXGEN_TEST_DATABASE_URL;
const parent = url.fileURLToPath(new URL("../", import.meta.url));
const root = "apps/api/src";
interface Row {
  entity: Record<string, unknown>;
  joins: Record<string, unknown>;
}
interface Page {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}
interface DatabaseTools {
  runMigrations(options: { directory: string }): Promise<void>;
  seedDatabase(options: { seed: number }): Promise<Record<string, unknown[]>>;
}
// Required in CI. Local opt-in always requires this explicitly named, isolated database.
describe
  .skipIf(!databaseUrl)
  .sequential("generated migrations, seeds and Neon PostgreSQL persistence", () => {
    let directory = "";
    let appDirectory = "";
    let sql: ReturnType<typeof neon.neon>;
    let load: ReturnType<typeof generatedRuntime>;
    let app: hono.Hono;
    let sqlText = "";
    let generatedFiles: Readonly<Record<string, string>> = {};
    let previousFetch: unknown;
    let previousDatabase: string | undefined;
    let previousEndpoint: unknown;
    async function reset() {
      await sql("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await sql("DROP SCHEMA public CASCADE");
      await sql("CREATE SCHEMA public");
    }
    async function prepare(auth = true) {
      const config = auth ? persistenceFixture() : constrainedPersistenceFixture();
      const project = resolvedFixture(config);
      const result = generateBackend(project, "api");
      if (!result.success) throw Error("Persistence fixture is not generation-ready");
      directory = await mkdtemp(path.join(parent, ".nordixgen-contract-types-"));
      if (
        !path
          .resolve(directory)
          .startsWith(`${path.resolve(parent)}${path.sep}.nordixgen-contract-types-`)
      )
        throw Error("Unsafe persistence fixture path");
      await result.virtualFileSystem.emit(directory);
      appDirectory = path.join(directory, "apps/api");
      await writeFile(path.join(appDirectory, "package.json"), '{"type":"module"}');
      const tooling = path.join(parent, "node_modules/drizzle-kit/bin.cjs");
      const migrationOutput = spawnSync(
        process.execPath,
        [tooling, "generate", "--config", path.join(appDirectory, "drizzle.config.ts")],
        {
          cwd: appDirectory,
          encoding: "utf8",
          stdio: "pipe",
          env: { ...process.env, DATABASE_URL: databaseUrl },
        },
      );
      const migrations = path.join(appDirectory, "drizzle");
      const names = (await readdir(migrations)).filter((name) => name.endsWith(".sql"));
      if (migrationOutput.status !== 0 || !names.length)
        throw Error(
          `Drizzle Kit produced no migration SQL: ${migrationOutput.stdout}\n${migrationOutput.stderr}`,
        );
      sqlText = (
        await Promise.all(names.map((name) => readFile(path.join(migrations, name), "utf8")))
      ).join("\n");
      generatedFiles = result.virtualFileSystem.snapshot();
      load = generatedRuntime(generatedFiles, {
        zod,
        hono,
        "hono/cors": cors,
        "hono/http-exception": httpException,
        "@hono/zod-validator": validator,
        "drizzle-orm": orm,
        "drizzle-orm/pg-core": pg,
        "drizzle-orm/neon-http": neonOrm,
        "drizzle-orm/neon-http/migrator": migrator,
        "@neondatabase/serverless": neon,
        "@faker-js/faker": faker,
        "node:path": path,
        "node:url": url,
        [`${root}/platform/authorization/repository.ts`]: {
          createIamRepository: () => ({
            principal: async () => ({
              id: "verified-server-user",
              role: "admin",
              permissions: ["*"],
            }),
          }),
        },
        [`${root}/platform/auth/auth.ts`]: {
          createAuth: () => ({
            api: {
              getSession: async () => ({ user: { id: "verified-server-user", role: "admin" } }),
            },
          }),
          isTrustedAuthOrigin: (origin: string) => origin === "https://web.example.test",
        },
      });
      await (
        load(`${root}/platform/database/migrate.ts`) as unknown as DatabaseTools
      ).runMigrations({ directory: migrations });
      app = load(`${root}/index.ts`).default as hono.Hono;
    }
    async function request(route: string, method = "GET", body?: unknown) {
      return app.request(
        route,
        {
          method,
          headers: { origin: "https://web.example.test", "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { DATABASE_URL: databaseUrl },
        { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
      );
    }
    async function rows(route: string, method = "GET", body?: unknown): Promise<Row[]> {
      const response = await request(route, method, body);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json() as Promise<Row[]>;
    }
    async function page(route: string): Promise<Page> {
      const response = await request(route);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json() as Promise<Page>;
    }
    beforeAll(async () => {
      if (!databaseUrl) throw Error("Set the explicit isolated database test URL");
      const parsed = new URL(databaseUrl);
      const port = process.env.NORDIXGEN_TEST_PROXY_PORT ?? "14444";
      if (
        parsed.hostname !== "db.localtest.me" ||
        parsed.username !== "nordixgen_test" ||
        parsed.pathname !== "/nordixgen_test" ||
        !/^\d{4,5}$/.test(port)
      )
        throw Error(
          "Refusing to migrate/seed anything except the explicitly isolated persistence test database.",
        );
      previousFetch = neon.neonConfig.fetchFunction;
      previousEndpoint = neon.neonConfig.fetchEndpoint;
      previousDatabase = process.env.DATABASE_URL;
      neon.neonConfig.fetchFunction = (target: string | URL, init: RequestInit) =>
        fetch(String(target).replace("http://127.0.0.1:4444/", `http://127.0.0.1:${port}/`), init);
      neon.neonConfig.fetchEndpoint = "http://127.0.0.1:4444/sql";
      process.env.DATABASE_URL = databaseUrl;
      sql = neon.neon(databaseUrl);
      await reset();
      await prepare();
    }, 60_000);
    afterAll(async () => {
      neon.neonConfig.fetchFunction = previousFetch;
      neon.neonConfig.fetchEndpoint = previousEndpoint as typeof neon.neonConfig.fetchEndpoint;
      if (previousDatabase === undefined) process.env.DATABASE_URL = undefined;
      else process.env.DATABASE_URL = previousDatabase;
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    it("generates and applies complete modular migration SQL with auth once", async () => {
      for (const table of [
        "customer",
        "customer_address",
        "invoice",
        "invoice_line",
        "auth_user",
        "session",
        "account",
        "verification",
      ])
        expect(sqlText.match(new RegExp(`CREATE TABLE "${table}"`, "g"))).toHaveLength(1);
      expect(sqlText.match(/CREATE TYPE "public"\."entity_state_enum"/g)).toHaveLength(1);
      const tables = await sql("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      expect(tables.map((row) => row.tablename)).toContain("invoice_line");
    });
    it("seeds both modules and their relation in deterministic order without auth identities", async () => {
      const seed = load(`${root}/platform/database/seed.ts`) as unknown as DatabaseTools;
      const first = await seed.seedDatabase({ seed: 2026 });
      expect(Object.keys(first).sort()).toEqual([
        "Customer",
        "CustomerAddress",
        "Invoice",
        "InvoiceLine",
      ]);
      for (const records of Object.values(first)) expect(records).toHaveLength(5);
      expect((await sql("SELECT count(*)::int AS count FROM auth_user"))[0].count).toBe(0);
      await sql('TRUNCATE "customer", "customer_address", "invoice", "invoice_line" CASCADE');
      const second = await seed.seedDatabase({ seed: 2026 });
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }, 60_000);
    let invoiceId = "";
    let lineId = "";
    it("persists declared creates/defaults/nulls and binds updates to an aliased identifier", async () => {
      const customerId = "11111111-1111-4111-8111-111111111111";
      const created = (
        await rows("/api/invoices", "POST", {
          customerId,
          total: 12.5,
          note: "Integration 50% discount",
        })
      )[0].entity;
      invoiceId = String(created.id);
      expect(created.total).toBe(12.5);
      expect(created.discount).toBeNull();
      expect(created.payload).toEqual({ currency: "USD" });
      expect(created.isDeleted).toBe(false);
      expect(typeof created.createdAt).toBe("string");
      const changed = (
        await rows(`/api/invoices/${invoiceId}`, "PATCH", {
          note: "Integration 50% revised",
          discount: 1.25,
        })
      )[0].entity;
      expect(changed.id).toBe(invoiceId);
      expect(changed.total).toBe(12.5);
      expect(changed.discount).toBe(1.25);
      const linked = (
        await rows("/api/lines", "POST", { invoiceId, quantity: 3, unitPrice: 2.5 })
      )[0].entity;
      lineId = String(linked.id);
    });
    it("supports main/joined operators, literal contains, pagination and declared projections", async () => {
      const invoices = await page("/api/invoices?search=Integration&minimum=10");
      expect(invoices.total).toBe(1);
      expect(invoices.items[0].entity.id).toBe(invoiceId);
      expect(invoices.items[0].joins.InvoiceLine).toEqual([{ quantity: 3, unitPrice: 2.5 }]);
      expect((await page("/api/lines?search=Integration&below=20&quantities=3")).total).toBe(1);
      expect((await page("/api/lines?search=Integration&below=10")).total).toBe(0);
      expect((await page("/api/invoices?search=%25")).total).toBe(1);
    });
    it("applies inner-join existence and active-related filters to rows and totals", async () => {
      await rows("/api/invoices", "POST", {
        customerId: "11111111-1111-4111-8111-111111111111",
        total: 15,
        note: "Integration without lines",
      });
      expect((await page("/api/invoices/with-lines?search=Integration")).total).toBe(1);
      await rows(`/api/lines/${lineId}`, "DELETE");
      expect((await page("/api/invoices/with-lines?search=Integration")).total).toBe(0);
      const left = await page("/api/invoices?search=Integration");
      expect(left.total).toBe(2);
      expect(left.items.find((row) => row.entity.id === invoiceId)?.joins.InvoiceLine).toEqual([]);
      expect(
        (
          await sql("SELECT deleted_at IS NOT NULL AS deleted FROM invoice_line WHERE id=$1", [
            lineId,
          ])
        )[0].deleted,
      ).toBe(true);
    });
    it("soft-deletes declared mutations and contains known persistence conflicts", async () => {
      const extra = (await rows("/api/lines", "POST", { invoiceId, quantity: 7, unitPrice: 1 }))[0]
        .entity;
      await rows(`/api/invoices/${invoiceId}`, "DELETE");
      expect(
        (await sql("SELECT is_deleted AS deleted FROM invoice WHERE id=$1", [invoiceId]))[0]
          .deleted,
      ).toBe(true);
      expect((await page("/api/lines?search=Integration&quantities=7")).total).toBe(0);
      expect(
        (await sql("SELECT count(*)::int AS count FROM invoice_line WHERE id=$1", [extra.id]))[0]
          .count,
      ).toBe(1);
      const conflict = await request("/api/lines", "POST", {
        invoiceId: "99999999-9999-4999-8999-999999999999",
        quantity: 1,
        unitPrice: 1,
      });
      expect(conflict.status).toBe(409);
      expect(await conflict.text()).not.toMatch(/insert into|foreign key|postgresql:\/\//i);
    });
    it("executes declared operation ports against the physical database", async () => {
      const createDb = load(`${root}/platform/database/drizzle-database.ts`)
        .createDrizzleDatabase as (url: string) => unknown;
      interface QueryPort {
        execute(input: {
          request: Record<string, unknown>;
          filters: unknown[];
          pagination?: { page: number; pageSize: number };
        }): Promise<Row[]>;
      }
      const Adapter = load(
        `${root}/modules/billing/infrastructure/adapters/CreateInvoice.drizzle.query.adapter.ts`,
      ).DrizzleCreateInvoiceQueryAdapter as new (
        db: unknown,
      ) => QueryPort;
      const created = await new Adapter(createDb(databaseUrl as string)).execute({
        request: {
          customerId: "11111111-1111-4111-8111-111111111111",
          total: 2.5,
          note: "Declared port contract",
        },
        filters: [],
      });
      expect(created[0].entity.total).toBe(2.5);
      expect(created[0].entity.discount).toBeNull();
      const id = String(created[0].entity.id);
      const stored = await sql("SELECT total,discount FROM invoice WHERE id=$1", [id]);
      expect(Number(stored[0].total)).toBe(2.5);
      expect(stored[0].discount).toBeNull();
      expect((await request(`/api/invoices/${id}`, "DELETE")).status).toBe(200);
      expect((await sql("SELECT is_deleted FROM invoice WHERE id=$1", [id]))[0].is_deleted).toBe(
        true,
      );
    }, 20_000);
    it("executes typed browser form mutations through generated Hono into PostgreSQL", async () => {
      const project = resolvedFixture(persistenceFixture());
      const files = generateFrontend(project, "web").virtualFileSystem.snapshot();
      const browser = frontendRuntime(
        files,
        "apps/web/src",
        {
          zod,
          "server-only": {},
          "@opennextjs/cloudflare": {
            getCloudflareContext: async () => ({
              env: {
                BACKEND_API: {
                  fetch: async (request: Request) =>
                    app.request(
                      request,
                      undefined,
                      { DATABASE_URL: databaseUrl },
                      { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
                    ),
                },
              },
            }),
          },
        },
        {
          fetch: async (target: URL, init: RequestInit) => {
            const headers = new Headers(init.headers);
            headers.set("origin", "https://web.example.test");
            const url = new URL(String(target), "https://web.example.test");
            expect(url.origin).toBe("https://web.example.test");
            expect(url.pathname).toMatch(/^\/api\/backend\/api\//);
            const segments = url.pathname
              .slice("/api/backend/".length)
              .split("/")
              .map(decodeURIComponent);
            const route = browser(
              "apps/web/src/app/api/backend/[backend]/[...path]/route.ts",
            ) as Record<
              string,
              (
                request: Request,
                context: { params: Promise<{ backend: string; path: string[] }> },
              ) => Promise<Response>
            >;
            return route[init.method ?? "GET"](new Request(url, { ...init, headers }), {
              params: Promise.resolve({ backend: segments[0], path: segments.slice(1) }),
            });
          },
        },
      );
      const forms = browser("apps/web/src/lib/api/forms.ts") as Record<
        string,
        (values: Record<string, unknown>, id?: string) => unknown
      >;
      const api = browser("apps/web/src/lib/api/endpoints.ts") as Record<
        string,
        (input: unknown) => Promise<Row[]>
      >;
      const created = (
        await api.createInvoice(
          forms.createInvoiceFormInput({
            customerId: "11111111-1111-4111-8111-111111111111",
            total: "2.50",
            discount: null,
            note: "Typed browser contract",
            issuedAt: "2026-10-18T12:34:56.000Z",
            payload: '"json string value"',
          }),
        )
      )[0].entity;
      expect(created).toMatchObject({
        total: 2.5,
        discount: null,
        issuedAt: "2026-10-18T12:34:56.000Z",
        payload: "json string value",
      });
      expect(
        (
          await request("/api/invoices", "POST", {
            customerId: "11111111-1111-4111-8111-111111111111",
            total: 2,
            payload: null,
          })
        ).status,
      ).toBe(400);
      const id = String(created.id);
      expect(
        (
          await api.updateInvoice(
            forms.updateInvoiceFormInput({ total: "3.25", discount: null }, id),
          )
        )[0].entity,
      ).toMatchObject({ id, total: 3.25, discount: null, issuedAt: created.issuedAt });
      await api.deleteInvoice(forms.deleteInvoiceFormInput({}, id));
      expect((await sql("SELECT is_deleted FROM invoice WHERE id=$1", [id]))[0].is_deleted).toBe(
        true,
      );
    }, 20_000);
    it("enforces signup password and server-owned role through real Better Auth and PostgreSQL", async () => {
      const live = generatedRuntime(generatedFiles, {
        zod,
        hono,
        "hono/cors": cors,
        "hono/http-exception": httpException,
        "@hono/zod-validator": validator,
        "drizzle-orm": orm,
        "drizzle-orm/pg-core": pg,
        "drizzle-orm/neon-http": neonOrm,
        "@neondatabase/serverless": neon,
        "better-auth": betterAuth,
        "@better-auth/drizzle-adapter": authAdapter,
        "node:path": path,
        "node:url": url,
      });
      const liveApp = live(`${root}/index.ts`).default as hono.Hono;
      const env = {
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_URL: "http://localhost:8787",
        BETTER_AUTH_SECRET: "isolated-test-secret-only-32-characters",
        AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
      };
      const authRequest = (route: string, body?: unknown, cookie?: string) =>
        liveApp.request(
          `http://localhost:8787${route}`,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              ...(cookie ? { cookie } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          env,
          { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
        );
      for (const password of ["1234", "x".repeat(ACCOUNT_POLICY.minPasswordLength - 1)]) {
        const response = await authRequest("/api/auth/sign-up/email", {
          name: "Short",
          email: "short@example.test",
          password,
        });
        expect(response.status).toBe(400);
      }
      expect((await sql("SELECT count(*)::int AS count FROM auth_user"))[0].count).toBe(0);
      const response = await authRequest("/api/auth/sign-up/email", {
        name: "Ordinary",
        email: "ordinary@example.test",
        password: "test-long-password-12",
        role: "admin",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const user = (await sql("SELECT role FROM auth_user WHERE email='ordinary@example.test'"))[0];
      expect(user.role).toBe("viewer");
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(cookie).not.toBe("");
      const session = await authRequest("/api/auth/get-session", undefined, cookie);
      expect(session.status).toBe(200);
      expect((await session.json()).user.role).toBe("viewer");
      expect((await authRequest("/api/invoices", {}, cookie)).status).toBe(403);
      expect((await authRequest("/api/invoices", {})).status).toBe(401);
      const adminTools = live(`${root}/platform/authorization/create-admin.ts`) as {
        createAdmin(email: string): Promise<void>;
      };
      await expect(adminTools.createAdmin("missing@example.test")).rejects.toThrow(
        "User not found",
      );
      await adminTools.createAdmin("ordinary@example.test");
      const iamRequest = (route: string, method = "GET", body?: unknown, token = cookie) =>
        liveApp.request(
          `http://localhost:8787/api/iam${route}`,
          {
            method,
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              cookie: token,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          env,
          { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
        );
      expect((await iamRequest("/permissions")).status).toBe(200);
      expect(
        (
          await iamRequest("/roles", "POST", {
            id: "auditor",
            name: "Auditor",
            permissions: ["invoices:read"],
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await iamRequest("/roles", "POST", {
            id: "invalid",
            name: "Invalid",
            permissions: ["unknown:permission"],
          })
        ).status,
      ).toBe(400);
      expect((await iamRequest("/roles/admin", "DELETE")).status).toBe(409);
      expect((await iamRequest("/roles/viewer", "DELETE")).status).toBe(409);
      expect((await iamRequest("/roles/admin", "PUT", { permissions: [] })).status).toBe(400);
      expect(
        (await iamRequest("/roles/viewer", "PUT", { permissions: ["iam:roles:manage"] })).status,
      ).toBe(400);
      const second = await authRequest("/api/auth/sign-up/email", {
        name: "Auditor",
        email: "auditor@example.test",
        password: "test-long-password-12",
      });
      expect(second.status).toBe(200);
      const secondId = (await second.json()).user.id as string;
      const secondCookie = second.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(
        (await iamRequest(`/users/${secondId}/role`, "POST", { role: "auditor" })).status,
      ).toBe(200);
      expect((await iamRequest("/roles/auditor", "DELETE")).status).toBe(409);
      expect((await iamRequest("/me", "GET", undefined, secondCookie)).status).toBe(200);
      const business = () =>
        liveApp.request(
          "http://localhost:8787/api/invoices",
          { headers: { cookie: secondCookie } },
          env,
          { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
        );
      expect((await business()).status).toBe(200);
      expect((await iamRequest("/roles/auditor", "PUT", { permissions: [] })).status).toBe(200);
      expect((await business()).status).toBe(403);
      const firstId = (await sql("SELECT id FROM auth_user WHERE email='ordinary@example.test'"))[0]
        .id as string;
      const last = await iamRequest(`/users/${firstId}/role`, "POST", {
        role: "viewer",
        confirmation: "anything",
      });
      expect(last.status).toBe(409);
      expect(await last.json()).toMatchObject({ code: "last_admin" });
      expect((await sql("SELECT role FROM auth_user WHERE id=$1", [firstId]))[0].role).toBe(
        "admin",
      );
      expect(
        (
          await iamRequest("/roles", "POST", {
            id: "delegated",
            name: "Delegated admin",
            permissions: ["iam:roles:manage", "iam:users:manage-roles"],
          })
        ).status,
      ).toBe(201);
      expect(
        (await iamRequest(`/users/${secondId}/role`, "POST", { role: "delegated" })).status,
      ).toBe(200);
      const selfEdit = await iamRequest(
        "/roles/delegated",
        "PUT",
        { permissions: ["iam:users:manage-roles"] },
        secondCookie,
      );
      expect(selfEdit.status).toBe(409);
      const editImpact = await selfEdit.json();
      expect(
        (await iamRequest("/roles/delegated", "PUT", { name: "Delegated administrator" })).status,
      ).toBe(200);
      expect(
        (
          await sql(
            "SELECT count(*)::int AS n FROM auth_role_permissions WHERE role_id='delegated'",
          )
        )[0].n,
      ).toBe(2);
      const stale = await iamRequest(
        "/roles/delegated",
        "PUT",
        { permissions: ["iam:users:manage-roles"], confirmation: editImpact.token },
        secondCookie,
      );
      expect(stale.status).toBe(409);
      const refreshedImpact = await stale.json();
      expect(refreshedImpact.code).toBe("confirmation_required");
      expect(refreshedImpact.token).not.toBe(editImpact.token);
      editImpact.token = refreshedImpact.token;

      expect(editImpact).toMatchObject({
        code: "confirmation_required",
        selfLoss: ["iam:roles:manage"],
        affected: 1,
      });
      expect(
        (
          await sql(
            "SELECT count(*)::int AS n FROM auth_role_permissions WHERE role_id='delegated'",
          )
        )[0].n,
      ).toBe(2);
      expect(
        (
          await iamRequest(
            "/roles/delegated",
            "PUT",
            { permissions: ["iam:users:manage-roles"], confirmation: editImpact.token },
            secondCookie,
          )
        ).status,
      ).toBe(200);
      expect((await iamRequest("/roles", "GET", undefined, secondCookie)).status).toBe(403);
      // Reassignment and role edits share the same global transaction lock.
      expect(
        (
          await iamRequest("/roles/delegated", "PUT", {
            permissions: ["iam:roles:manage", "iam:users:manage-roles"],
          })
        ).status,
      ).toBe(200);
      const own = await iamRequest(`/users/${firstId}/role`, "POST", { role: "viewer" });
      const other = await iamRequest(
        `/users/${secondId}/role`,
        "POST",
        { role: "viewer" },
        secondCookie,
      );
      expect(own.status).toBe(409);
      expect(other.status).toBe(409);
      const ownImpact = await own.json();
      const otherImpact = await other.json();
      expect(ownImpact.selfLoss).toEqual(["iam:roles:manage", "iam:users:manage-roles"]);
      const race = await Promise.all([
        iamRequest(`/users/${firstId}/role`, "POST", {
          role: "viewer",
          confirmation: ownImpact.token,
        }),
        iamRequest(
          `/users/${secondId}/role`,
          "POST",
          { role: "viewer", confirmation: otherImpact.token },
          secondCookie,
        ),
      ]);
      expect(race.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(
        (
          await sql("SELECT count(*)::int AS n FROM auth_user WHERE role IN ('admin','delegated')")
        )[0].n,
      ).toBe(1);
      await adminTools.createAdmin("ordinary@example.test");
      const restore = await iamRequest(`/users/${secondId}/role`, "POST", { role: "auditor" });
      if (restore.status === 409) {
        const impact = await restore.json();
        expect(impact.code).toBe("confirmation_required");
        expect(
          (
            await iamRequest(`/users/${secondId}/role`, "POST", {
              role: "auditor",
              confirmation: impact.token,
            })
          ).status,
        ).toBe(200);
      } else expect(restore.status).toBe(200);

      expect(
        (await iamRequest(`/users/${firstId}/role`, "POST", { role: "delegated" })).status,
      ).toBe(200);
      const lastRoleEdit = await iamRequest("/roles/delegated", "PUT", {
        permissions: ["iam:roles:manage"],
        confirmation: "cannot-override",
      });
      expect(lastRoleEdit.status).toBe(409);
      expect(await lastRoleEdit.json()).toMatchObject({ code: "last_admin" });
      await adminTools.createAdmin("ordinary@example.test");
      await sql("ALTER TABLE auth_iam_audit RENAME TO isolated_audit_unavailable");
      try {
        const failedAudit = await iamRequest("/roles/auditor", "PUT", {
          name: "Must roll back",
          permissions: ["invoices:read"],
        });
        expect(failedAudit.status).toBe(500);
        expect((await sql("SELECT name FROM auth_roles WHERE id='auditor'"))[0].name).toBe(
          "Auditor",
        );
        expect(
          (
            await sql(
              "SELECT count(*)::int AS n FROM auth_role_permissions WHERE role_id='auditor'",
            )
          )[0].n,
        ).toBe(0);
      } finally {
        await sql("ALTER TABLE isolated_audit_unavailable RENAME TO auth_iam_audit");
      }
      const audit = await iamRequest("/audit");
      expect(audit.status).toBe(200);
      expect(await audit.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorId: firstId,
            action: "user.role-assigned",
            targetId: secondId,
          }),
          expect.objectContaining({
            actorId: secondId,
            action: "role.updated",
            targetId: "delegated",
          }),
        ]),
      );
      // Re-running seed must not resurrect grants removed by an operator.
      await sql("DELETE FROM auth_role_permissions WHERE role_id='viewer'");
      const currentDb = live(`${root}/platform/database/drizzle-database.ts`)
        .createDrizzleDatabase as (url: string) => unknown;
      const originalSeed = generatedRuntime(generatedFiles, { "drizzle-orm": orm });
      await (
        originalSeed(`${root}/platform/authorization/seed.ts`).seedAuthorization as (
          db: unknown,
        ) => Promise<void>
      )(currentDb(databaseUrl as string));
      expect(
        (
          await sql(
            "SELECT count(*)::int AS count FROM auth_role_permissions WHERE role_id='viewer'",
          )
        )[0].count,
      ).toBe(0);
      // New YAML roles are initialized without changing existing roles, metadata or grants.
      const updated = persistenceFixture();
      updated.backends[0].authorization.roles.push("newteam");
      updated.backends[0].authorization.rolePermissions.newteam = ["invoices:read"];
      const regenerated = generateBackend(resolvedFixture(updated), "api");
      if (!regenerated.success) throw Error("Invalid updated seed fixture");
      const updatedLoad = generatedRuntime(
        {
          ...generatedFiles,
          [`${root}/platform/authorization/seed.ts`]: regenerated.virtualFileSystem.readFile(
            `${root}/platform/authorization/seed.ts`,
          ) as string,
        },
        { "drizzle-orm": orm },
      );
      const db = live(`${root}/platform/database/drizzle-database.ts`).createDrizzleDatabase as (
        url: string,
      ) => unknown;
      const updatedSeed = updatedLoad(`${root}/platform/authorization/seed.ts`)
        .seedAuthorization as (db: unknown) => Promise<void>;
      await Promise.all([
        updatedSeed(db(databaseUrl as string)),
        updatedSeed(db(databaseUrl as string)),
      ]);
      expect(
        (await sql("SELECT permission FROM auth_role_permissions WHERE role_id='newteam'"))[0]
          .permission,
      ).toBe("invoices:read");
      expect(
        (
          await sql(
            "SELECT count(*)::int AS count FROM auth_role_permissions WHERE role_id='viewer'",
          )
        )[0].count,
      ).toBe(0);
      await Promise.all([
        iamRequest("/roles/newteam", "PUT", { permissions: ["customers:read"] }),
        iamRequest("/roles/newteam", "PUT", { permissions: ["invoices:read"] }),
      ]);
      const concurrentGrants = await sql(
        "SELECT permission FROM auth_role_permissions WHERE role_id='newteam'",
      );
      expect(concurrentGrants).toHaveLength(1);
      expect(["customers:read", "invoices:read"]).toContain(concurrentGrants[0].permission);
      await sql("UPDATE auth_roles SET is_system=false WHERE id='viewer'");
      expect((await iamRequest("/roles/viewer", "DELETE")).status).toBe(409);
      await sql("UPDATE auth_roles SET is_system=true WHERE id='viewer'");
      await sql(
        "INSERT INTO auth_role_permissions(role_id,permission) VALUES('viewer','iam:roles:manage')",
      );
      await expect(
        (
          originalSeed(`${root}/platform/authorization/seed.ts`).seedAuthorization as (
            db: unknown,
          ) => Promise<void>
        )(currentDb(databaseUrl as string)),
      ).rejects.toThrow("signup default role has IAM privileges");
      await sql("DELETE FROM auth_role_permissions WHERE role_id='viewer'");
      expect((await iamRequest(`/users/${secondId}/role`, "POST", { role: "viewer" })).status).toBe(
        200,
      );
      expect((await iamRequest("/roles/auditor", "DELETE")).status).toBe(204);
      expect(
        (await iamRequest(`/users/${secondId}/role`, "POST", { role: "auditor" })).status,
      ).toBe(404);
      const forged = await authRequest(
        "/api/auth/get-session",
        undefined,
        "better-auth.session_token=forged",
      );
      expect(await forged.json()).toBeNull();
      expect((await authRequest("/api/auth/sign-out", {}, cookie)).status).toBe(200);
      expect(
        await (await authRequest("/api/auth/get-session", undefined, cookie)).json(),
      ).toBeNull();
      // This full IAM journey makes many sequential requests through the real Neon proxy.
      // Allow slower CI runners to finish before teardown removes the auth tables.
    }, 120_000);
    it("applies a decimal database default when an insert omits the numeric column", async () => {
      const [row] = await sql("INSERT INTO invoice (customer_id) VALUES ($1) RETURNING id, total", [
        "11111111-1111-4111-8111-111111111111",
      ]);
      try {
        expect(Number(row.total)).toBe(12.5);
      } finally {
        await sql("DELETE FROM invoice WHERE id=$1", [row.id]);
      }
    });
    it("also migrates and seeds the intentionally unauthenticated schema", async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
      directory = "";
      await reset();
      await prepare(false);
      expect(sqlText).not.toContain('CREATE TABLE "auth_user"');
      const seeded = await (
        load(`${root}/platform/database/seed.ts`) as unknown as DatabaseTools
      ).seedDatabase({ seed: 2026 });
      expect(seeded.InvoiceLine).toHaveLength(5);
      expect(seeded.SeedConstraint).toHaveLength(2);
      expect(seeded.SeedDetail).toHaveLength(2);
      const constraints = await sql("SELECT * FROM seed_constraint ORDER BY count");
      expect(constraints.map((row) => row.nullable_label)).toEqual([null, null]);
      expect(new Set(constraints.map((row) => row.code)).size).toBe(2);
    }, 60_000);
  });
