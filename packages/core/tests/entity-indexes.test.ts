import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { createValidConfig, resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

function configuration(indexes: unknown) {
  const config = createValidConfig();
  Object.assign(config.entities.Order, { indexes });
  return config;
}

describe("explicit entity indexes", () => {
  it("preserves ordered scalar, generated and foreign-key columns in executable Drizzle schemas", () => {
    const project = resolvedFixture(
      configuration([
        { fields: ["status"] },
        { fields: ["customer_id", "createdAt"] },
        { fields: ["createdAt", "customer_id"] },
      ]),
    );
    expect(project.entities.Order.indexes[1].fields).toEqual(["customer_id", "createdAt"]);
    const files = generateBackend(project, "core-api").virtualFileSystem.snapshot();
    const file = Object.keys(files).find((path) => path.endsWith("/Order.table.ts"));
    if (!file) throw Error("Missing generated table");
    const table = generatedRuntime(files, { "drizzle-orm": orm, "drizzle-orm/pg-core": pg })(file)
      .OrderTable as pg.PgTable;
    const indexes = pg.getTableConfig(table).indexes;
    expect(
      indexes.map((index) => index.config.columns.map((column) => (column as pg.PgColumn).name)),
    ).toEqual([["status"], ["customer_id", "created_at"], ["created_at", "customer_id"]]);
    const names = indexes.map((index) => index.config.name);
    expect(new Set(names).size).toBe(3);
    expect(names.every((name) => Buffer.byteLength(name) <= 63)).toBe(true);
    expect(generateBackend(project, "core-api").virtualFileSystem.snapshot()[file]).toBe(
      files[file],
    );
  });

  it.each([
    [[], true],
    [[{ fields: [] }], false],
    [[{ fields: ["status", "status"] }], false],
    [[{ fields: ["customer"] }], false],
    [[{ fields: ["missing"] }], false],
    [[{ fields: ["status"] }, { fields: ["status"] }], false],
    [[{ fields: ["id"] }], false],
    [[{ fields: ["status"], where: "status IS NOT NULL" }], false],
  ])("validates index declarations %j", (indexes, valid) => {
    expect(validateNordixConfig(configuration(indexes)).success).toBe(valid);
  });

  it("rejects redundant unique-field indexes and reports unknown fields before generation", () => {
    const config = createValidConfig();
    Object.assign(config.entities.Customer, { indexes: [{ fields: ["email"] }] });
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "REDUNDANT_ENTITY_INDEX" }),
    );
    expect(
      validateNordixConfig(configuration([{ fields: ["missing"] }])).diagnostics,
    ).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_INDEX_FIELD",
        path: "entities.Order.indexes.0.fields",
      }),
    );
  });

  it("keeps old YAML compatible and gives long field lists stable bounded names", () => {
    expect(resolvedFixture(createValidConfig()).entities.Order.indexes).toEqual([]);
    const config = configuration([
      { fields: ["status", "total", "customer_id", "createdAt", "updatedAt", "isDeleted"] },
    ]);
    const files = generateBackend(resolvedFixture(config), "core-api").virtualFileSystem.snapshot();
    const source = Object.entries(files).find(([path]) => path.endsWith("/Order.table.ts"))?.[1];
    expect(source).toMatch(/index\("ng_order_[0-9a-f]{16}_idx"\)/);
  });
});
