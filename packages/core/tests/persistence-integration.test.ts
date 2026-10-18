import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import * as faker from "@faker-js/faker";
import * as validator from "@hono/zod-validator";
import * as neon from "@neondatabase/serverless";
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
import { resolvedFixture } from "./fixtures.js";
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
interface InvoiceRepository {
  findById(id: string): Promise<Record<string, unknown> | null>;
  findMany(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  findPage(
    filter: Record<string, unknown>,
    offset: number,
    limit: number,
  ): Promise<{ items: Record<string, unknown>[]; total: number }>;
  create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, changes: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  delete(id: string): Promise<void>;
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
      load = generatedRuntime(result.virtualFileSystem.snapshot(), {
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
    it("executes owned repository ports against the same physical database", async () => {
      const createDb = load(`${root}/platform/database/drizzle-database.ts`)
        .createDrizzleDatabase as (url: string) => unknown;
      const Repository = load(
        `${root}/modules/billing/infrastructure/adapters/Invoice.drizzle.repository.ts`,
      ).DrizzleInvoiceRepository as new (
        db: unknown,
      ) => InvoiceRepository;
      const repository = new Repository(createDb(databaseUrl as string));
      const created = await repository.create({
        customerId: "11111111-1111-4111-8111-111111111111",
        total: "2.50",
        note: "Repository contract",
      });
      const id = String(created.id);
      expect(created.total).toBe(2.5);
      expect(created.discount).toBeNull();
      expect((await repository.update(id, { discount: "1.25" }))?.discount).toBe(1.25);
      expect((await repository.findMany({ id })).map((row) => row.id)).toEqual([id]);
      const page = await repository.findPage({ id }, 0, 1);
      expect(page.total).toBe(1);
      expect(page.items[0].id).toBe(id);
      await repository.delete(id);
      expect(await repository.findById(id)).toBeNull();
      expect((await repository.findPage({ id }, 0, 1)).total).toBe(0);
      expect((await sql("SELECT is_deleted FROM invoice WHERE id=$1", [id]))[0].is_deleted).toBe(
        true,
      );
    }, 20_000);
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
