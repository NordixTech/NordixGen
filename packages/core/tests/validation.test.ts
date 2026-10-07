import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseNordixYaml, validateNordixConfig } from "../src/configuration/validate.js";
import { buildIntermediateRepresentation } from "../src/intermediate-representation.js";
import { comprehensiveYaml, createValidConfig } from "./fixtures.js";

describe("config validation", () => {
  it("accepts a complete config and a representative YAML document", () => {
    expect(validateNordixConfig(createValidConfig())).toMatchObject({
      success: true,
      diagnostics: [],
    });
    expect(parseNordixYaml(comprehensiveYaml).success).toBe(true);
  });

  it("parses the shipped ecommerce example and builds its dependency-ordered representation", async () => {
    const source = await readFile(
      new URL("../../../examples/ecommerce.yaml", import.meta.url),
      "utf8",
    );
    const result = parseNordixYaml(source);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(buildIntermediateRepresentation(result.config).entityOrder).toEqual([
      "Category",
      "Product",
      "User",
      "Order",
      "OrderItem",
    ]);
  });

  it("returns useful schema diagnostics for root and nested failures", () => {
    const rootResult = validateNordixConfig(null);
    expect(rootResult.success).toBe(false);
    if (!rootResult.success) expect(rootResult.diagnostics[0]?.path).toBe("");
    const nestedResult = validateNordixConfig({
      ...createValidConfig(),
      entities: { User: { fields: { name: { type: "missing" } } } },
    });
    expect(nestedResult.success).toBe(false);
    if (!nestedResult.success)
      expect(
        nestedResult.diagnostics.some((diagnostic) =>
          diagnostic.path.includes("entities.User.fields.name"),
        ),
      ).toBe(true);
  });

  it("checks defaults against all supported primitive and enum field types", () => {
    const config = createValidConfig();
    config.entities.User.fields = {
      email: { type: "string" },
      stringValue: { type: "string", default: "name" },
      numberValue: { type: "number", default: 2 },
      booleanValue: { type: "boolean", default: false },
      dateValue: { type: "date", default: "2026-10-07T00:00:00Z" },
      uuidValue: { type: "uuid", default: "550e8400-e29b-41d4-a716-446655440000" },
      jsonValue: { type: "json", default: { nested: [1, true] } },
      enumValue: { type: "enum", enumName: "OrderStatus", default: "PENDING" },
    };
    expect(validateNordixConfig(config).success).toBe(true);
    config.entities.User.fields.numberValue = { type: "number", default: "2" };
    config.entities.User.fields.dateValue = { type: "date", default: "not-a-date" };
    config.entities.User.fields.uuidValue = { type: "uuid", default: "not-a-uuid" };
    config.entities.User.fields.enumValue = {
      type: "enum",
      enumName: "OrderStatus",
      default: "UNKNOWN",
    };
    expect(validateNordixConfig(config).diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "INVALID_FIELD_DEFAULT",
    );
  });

  it("reports unknown enums and invalid enum defaults", () => {
    const config = createValidConfig();
    config.entities.User.fields.role = { type: "enum", enumName: "Missing", default: "ADMIN" };
    const result = validateNordixConfig(config);
    expect(result.success).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("UNKNOWN_ENUM");
  });

  it("validates relation targets, member collisions, nullable deletes, and many-to-many keys", () => {
    const config = createValidConfig();
    config.entities.Order.fields.customer = { type: "string" };
    config.entities.Order.relations = {
      customer: { type: "many-to-one", target: "Missing", onDelete: "set-null", required: true },
      labels: { type: "many-to-many", target: "User", foreignKey: "user_id" },
    };
    const codes = validateNordixConfig(config).diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "UNKNOWN_RELATION_TARGET",
        "DUPLICATE_ENTITY_MEMBER",
        "INVALID_SET_NULL_RELATION",
        "INVALID_MANY_TO_MANY_FOREIGN_KEY",
      ]),
    );
  });

  it("rejects fields reserved for generated identifiers and audit metadata", () => {
    const config = createValidConfig();
    config.entities.User.fields.id = { type: "string" };
    config.entities.User.fields.createdAt = { type: "date" };
    config.entities.User.fields.deletedAt = { type: "date", required: false };
    const diagnostics = validateNordixConfig(config).diagnostics;
    expect(
      diagnostics.filter((diagnostic) => diagnostic.code === "RESERVED_GENERATED_FIELD"),
    ).toHaveLength(3);
  });

  it("rejects duplicate app names and paths, and unsafe relative paths", () => {
    const duplicateConfig = createValidConfig();
    const duplicateFrontend = duplicateConfig.frontends[0] as { name: string; path: string };
    duplicateFrontend.name = "core-api";
    duplicateFrontend.path = "apps/api-core";
    const duplicateCodes = validateNordixConfig(duplicateConfig).diagnostics.map(
      (diagnostic) => diagnostic.code,
    );
    expect(duplicateCodes).toContain("DUPLICATE_APP_NAME");
    expect(duplicateCodes).toContain("DUPLICATE_APP_PATH");

    const unsafeConfig = createValidConfig();
    (unsafeConfig.frontends[0] as { path: string }).path = "../outside";
    expect(
      validateNordixConfig(unsafeConfig).diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("UNSAFE_APP_PATH");
  });

  it("validates endpoint entities, roles, duplicate routes, join projections, and enum parameters", () => {
    const config = createValidConfig();
    config.endpoints.push({
      path: "/api/orders/summary",
      method: "GET",
      entity: "Missing",
      roles: ["owner"],
      permissions: ["billing:read"],
      pathParams: [{ name: "status", type: "enum", enumName: "MissingEnum" }],
      joins: [
        { entity: "MissingJoin", type: "left", fields: ["ignored"] },
        { entity: "User", type: "inner", fields: ["unknownField", "createdAt", "id"] },
      ],
    });
    const codes = validateNordixConfig(config).diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ENDPOINT",
        "UNKNOWN_ENDPOINT_ENTITY",
        "UNKNOWN_ENDPOINT_ROLE",
        "UNKNOWN_JOIN_ENTITY",
        "UNKNOWN_ENDPOINT_PERMISSION",
        "UNKNOWN_JOIN_FIELD",
        "UNKNOWN_PARAMETER_ENUM",
      ]),
    );
  });

  it("validates a missing parameter enum name and rejects YAML syntax or duplicate-key errors", () => {
    const config = createValidConfig();
    (config.endpoints[0] as { queryParams: unknown[] }).queryParams = [
      { name: "status", type: "enum", required: false },
    ];
    expect(validateNordixConfig(config).diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "UNKNOWN_PARAMETER_ENUM",
    );
    expect(parseNordixYaml("name: broken\nversion: [\n").diagnostics[0]?.code).toBe(
      "YAML_SYNTAX_ERROR",
    );
    expect(parseNordixYaml("a: [").diagnostics[0]?.path).toBe("line 1, column 5");
    expect(parseNordixYaml("name: sample\nname: duplicate\n").diagnostics[0]?.code).toBe(
      "YAML_SYNTAX_ERROR",
    );
  });

  it("checks endpoint role and permission declarations against unauthenticated backends", () => {
    const config = createValidConfig();
    config.backends = [
      { name: "api", framework: "hono", path: "apps/api", auth: { type: "none" } },
    ];
    const endpoint = config.endpoints[0] as { roles: string[]; permissions: string[] };
    endpoint.roles = ["admin"];
    endpoint.permissions = ["orders:read"];
    expect(validateNordixConfig(config).diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_ENDPOINT_ROLE", "UNKNOWN_ENDPOINT_PERMISSION"]),
    );
  });
});
