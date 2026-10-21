import { describe, expect, it } from "vitest";
import type { FieldDefinition, NordixConfig } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { targetConfig } from "./fixtures.js";

function withField(field: Record<string, unknown>) {
  const config = targetConfig("single-module");
  config.entities.Note.fields.value = field as FieldDefinition;
  return validateNordixConfig(config);
}
describe("field defaults and relationship ownership", () => {
  it.each([
    { type: "string", default: "ok", minLength: 2, maxLength: 2 },
    { type: "number", format: "integer", default: 7 },
    { type: "number", format: "decimal", precision: 5, scale: 2, default: 7.25 },
    { type: "boolean", default: false },
    { type: "date", default: "2024-02-29T12:00:00+03:00" },
    { type: "date", default: { kind: "now" } },
    { type: "uuid", default: "123e4567-e89b-42d3-a456-426614174000" },
    { type: "json", default: { list: [null, 1, true, "ok", { nested: [] }] } },
    { type: "string", required: false, default: null },
  ])("accepts a type-compatible constrained default: %j", (field) => {
    expect(withField(field)).toMatchObject({ success: true, diagnostics: [] });
  });
  it.each([
    { type: "string", default: 12 },
    { type: "string", default: "x", minLength: 2 },
    { type: "string", default: "long", maxLength: 2 },
    { type: "number", default: Number.POSITIVE_INFINITY },
    { type: "number", format: "integer", default: 1.5 },
    { type: "boolean", default: "false" },
    { type: "date", default: "2023-02-29T00:00:00Z" },
    { type: "date", default: "2024-02-30T00:00:00Z" },
    { type: "date", default: "2024-01-01" },
    { type: "date", default: { kind: "now", expression: "private" } },
    { type: "uuid", default: "not-a-uuid" },
    { type: "json", default: { missing: undefined } },
    { type: "json", default: [() => "private"] },
    { type: "json", default: [Number.NaN] },
  ])("rejects a type-incompatible default: %j", (field) => {
    expect(withField(field).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_FIELD_DEFAULT",
        path: "entities.Note.fields.value.default",
        message: expect.stringContaining("default"),
      }),
    );
  });
  const cases: [string, (c: NordixConfig) => void, string][] = [
    [
      "unknown entity backend",
      (c) => {
        c.entities.Customer.backend = "ghost";
      },
      "UNKNOWN_ENTITY_BACKEND",
    ],
    [
      "unknown relation target",
      (c) => {
        c.entities.CustomerAddress.relations.customer.target = "Missing";
      },
      "UNKNOWN_RELATION_TARGET",
    ],
    [
      "duplicate SQL fields",
      (c) => {
        c.entities.Customer.fields.displayName = { type: "string", required: true, unique: false };
        c.entities.Customer.fields.display_name = {
          type: "string",
          required: true,
          unique: false,
        };
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "generated timestamp collision",
      (c) => {
        c.entities.Customer.timestamps.createdAt = true;
        c.entities.Customer.fields.created_at = { type: "date", required: true, unique: false };
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "duplicate owning foreign keys",
      (c) => {
        c.entities.CustomerAddress.relations.otherCustomer = structuredClone(
          c.entities.CustomerAddress.relations.customer,
        );
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "inverse delete policy",
      (c) => {
        c.entities.Customer.relations.addresses.onDelete = "cascade";
      },
      "RELATION_DELETE_POLICY_INVALID",
    ],
    [
      "required collection",
      (c) => {
        c.entities.Customer.relations.addresses.required = true;
      },
      "RELATION_NULLABILITY_INVALID",
    ],
    [
      "join table on owning relation",
      (c) => {
        c.entities.CustomerAddress.relations.customer.joinTable = "bad";
      },
      "RELATION_JOIN_TABLE_INVALID",
    ],
    [
      "incompatible explicit FK",
      (c) => {
        c.entities.CustomerAddress.fields.customerId = {
          type: "string",
          required: false,
          unique: false,
        };
      },
      "RELATION_FOREIGN_KEY_MISMATCH",
    ],
    [
      "FK replacing generated identity",
      (c) => {
        c.entities.CustomerAddress.relations.customer.foreignKey = "id";
      },
      "RESERVED_GENERATED_FIELD",
    ],
    [
      "field and relation same name",
      (c) => {
        c.entities.Customer.fields.addresses = { type: "json", required: false, unique: false };
      },
      "DUPLICATE_ENTITY_MEMBER",
    ],
    [
      "unknown enum",
      (c) => {
        c.entities.Customer.fields.status = {
          type: "enum",
          enumName: "Missing",
          required: true,
          unique: false,
        };
      },
      "UNKNOWN_ENUM",
    ],
    [
      "reversed string limits",
      (c) => {
        c.entities.Customer.fields.name = {
          type: "string",
          minLength: 10,
          maxLength: 2,
          required: true,
          unique: false,
        };
      },
      "FIELD_CONSTRAINT_INVALID",
    ],
    [
      "join table overwrites entity",
      (c) => {
        c.entities.Customer.relations.related = {
          type: "many-to-many",
          target: "CustomerAddress",
          joinTable: "customer_address",
          required: false,
        };
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "join table nullable delete",
      (c) => {
        c.entities.Customer.relations.related = {
          type: "many-to-many",
          target: "CustomerAddress",
          onDelete: "set-null",
          required: false,
        };
      },
      "INVALID_SET_NULL_RELATION",
    ],
    [
      "many-to-many with single FK",
      (c) => {
        c.entities.Customer.relations.related = {
          type: "many-to-many",
          target: "CustomerAddress",
          foreignKey: "addressId",
          required: false,
        };
      },
      "INVALID_MANY_TO_MANY_FOREIGN_KEY",
    ],
  ];
  it.each(cases)("rejects %s before rendering", (_name, mutate, code) => {
    const config = targetConfig();
    mutate(config);
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({
        code,
        path: expect.stringMatching(/^entities\./),
        message: expect.any(String),
      }),
    );
  });
  it("accepts a matching explicit owning UUID and a valid enum default", () => {
    const config = targetConfig();
    const relation = config.entities.CustomerAddress.relations.customer;
    config.entities.CustomerAddress.fields.customerId = {
      type: "uuid",
      required: relation.required,
      unique: false,
    };
    config.enums.Status = ["active", "disabled"];
    config.entities.Customer.fields.status = {
      type: "enum",
      enumName: "Status",
      default: "active",
      required: true,
      unique: false,
    };
    expect(validateNordixConfig(config)).toMatchObject({ success: true, diagnostics: [] });
  });
});
