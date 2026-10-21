import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateBackend, moduleRenderContext } from "../src/generation/backend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedTypeErrors } from "./generated-types.js";
import { constrainedPersistenceFixture } from "./persistence-fixture.js";
function fixture() {
  const config = targetConfig();
  for (const businessModule of Object.values(config.backends[0].modules)) {
    businessModule.exports = [];
    businessModule.imports = {};
  }
  return resolvedFixture(config);
}

describe("Clean business modules in one backend", () => {
  it("compiles owned schemas, bounded unique seeds and declared SQL operations", async () => {
    const result = generateBackend(resolvedFixture(constrainedPersistenceFixture()), "api");
    if (!result.success) throw Error("Invalid persistence fixture");
    const sources = Object.fromEntries(
      Object.entries(result.virtualFileSystem.snapshot())
        .filter(([name]) => name.endsWith(".ts"))
        .map(([name, content]) => [name.slice("apps/api/".length), content]),
    );
    expect(await generatedTypeErrors(sources)).toEqual([]);
  }, 20_000);
  it("typechecks two persisted modules with real Hono/Drizzle/Better Auth dependencies", async () => {
    const project = fixture();
    const output = generateBackend(project, "api");
    expect(output.success).toBe(true);
    if (!output.success) return;
    const files = output.virtualFileSystem.snapshot();
    const sources = Object.fromEntries(
      Object.entries(files)
        .filter(([path]) => path.endsWith(".ts"))
        .map(([path, content]) => [path.slice("apps/api/".length), content]),
    );
    sources["src/modules/billing/infrastructure/database/scope.ts"] = `
import type {DrizzleDatabase} from "./client.js";
declare const db:DrizzleDatabase;
db.query.InvoiceTable;
// @ts-expect-error Another module's query is unavailable through this module's database type.
db.query.CustomerTable;
`;
    expect(await generatedTypeErrors(sources)).toEqual([]);
    expect(
      files["apps/api/src/modules/customers/domain/entities/Customer.entity.ts"],
    ).toBeDefined();
    expect(files["apps/api/src/modules/billing/domain/entities/Invoice.entity.ts"]).toBeDefined();
    expect(
      files["apps/api/src/modules/billing/domain/entities/Customer.entity.ts"],
    ).toBeUndefined();
    expect(
      Object.keys(files).some(
        (path) =>
          path.startsWith("apps/api/src/domain/") || path.startsWith("apps/api/src/application/"),
      ),
    ).toBe(false);
    expect(Object.keys(files).filter((path) => path.endsWith("/drizzle-database.ts"))).toHaveLength(
      1,
    );
    expect(Object.keys(files).filter((path) => path.endsWith("/auth-schema.ts"))).toHaveLength(1);
    const composition = files["apps/api/src/platform/database/create-route-dependencies.ts"];
    expect(composition.split("createDrizzleDatabase(connectionString)")).toHaveLength(2);
    expect(composition).toContain("module0(db,");
    expect(composition).toContain("module1(db,");
    const routes = files["apps/api/src/platform/http/controllers/routes.ts"];
    expect(routes).toContain("/modules/customers/");
    expect(routes).toContain("/modules/billing/");
  }, 20_000);
  it("keeps module selection explicit and rejects a module from a different backend", () => {
    const project = fixture();
    expect(
      moduleRenderContext(project, "api", "api.customers").domainModel.entities.Invoice,
    ).toBeUndefined();
    expect(() => moduleRenderContext(project, "api", "missing")).toThrow("UNKNOWN_MODULE_TARGET");
  });
  it("executes generated boundary checks and catches inward, private and undeclared imports", async () => {
    const project = fixture();
    const output = generateBackend(project, "api");
    if (!output.success) throw Error("Invalid fixture");
    const parent = fileURLToPath(new URL("../", import.meta.url));
    const directory = await mkdtemp(join(parent, ".nordixgen-contract-types-"));
    if (!resolve(directory).startsWith(`${resolve(parent)}${sep}.nordixgen-contract-types-`))
      throw Error("Unsafe boundary fixture path");
    try {
      await output.virtualFileSystem.emit(directory);
      const app = join(directory, "apps/api");
      const script = join(app, "scripts/check-boundaries.mjs");
      const run = () =>
        execFileSync(process.execPath, [script], { cwd: app, encoding: "utf8", stdio: "pipe" });
      expect(run()).toContain("boundaries passed");
      const bad = join(app, "src/modules/billing/application/bad.ts");
      await mkdir(dirname(bad), { recursive: true });
      for (const [source, code] of [
        [`import {Hono} from "hono";`, "ARCHITECTURE_DEPENDENCY_INVALID"],
        [
          `import * as schema from "../../../platform/database/schema/index.js";`,
          "MODULE_PRIVATE_SCHEMA_IMPORT",
        ],
        [
          `import type {DrizzleDatabase} from "../../../platform/database/drizzle-database.js";`,
          "MODULE_SHARED_DATABASE_IMPORT",
        ],
        [
          `import type {Customer} from "../../customers/domain/entities/Customer.entity.js";`,
          "MODULE_PRIVATE_IMPORT",
        ],
        [
          `import type {PublicApi} from "../../customers/index.js";`,
          "MODULE_DEPENDENCY_UNDECLARED",
        ],
        [
          `await import("../../customers/infrastructure/database/schema/Customer.table.js");`,
          "MODULE_PRIVATE_IMPORT",
        ],
      ]) {
        await writeFile(bad, source);
        expect(() => run()).toThrow(code);
      }
      await writeFile(bad, "");
      await writeFile(
        join(app, "src/modules/billing/index.ts"),
        'export * from "./infrastructure/database/schema/Invoice.table.js";',
      );
      expect(() => run()).toThrow("MODULE_PRIVATE_EXPORT");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("module view ownership guards", () => {
  it("rejects a real module owned by another backend and keeps unused enums out of a domain", () => {
    const config = targetConfig();
    config.enums.Unused = ["draft"];
    config.backends.push({
      name: "other",
      repository: "app",
      path: "apps/other",
      modules: {
        reports: { architecture: "clean", entities: ["Report"], exports: [], imports: {} },
      },
    });
    config.entities.Report = {
      backend: "other",
      fields: { title: { type: "string", required: true, unique: false } },
      relations: {},
      timestamps: { createdAt: false, updatedAt: false },
      softDelete: false,
    };
    const project = resolvedFixture(config);
    expect(() => moduleRenderContext(project, "api", "other.reports")).toThrow(
      "UNKNOWN_MODULE_TARGET",
    );
    expect(
      moduleRenderContext(project, "other", "other.reports").domainModel.enums.Unused,
    ).toBeUndefined();
  });
});
