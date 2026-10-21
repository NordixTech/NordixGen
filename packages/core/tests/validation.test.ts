import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { generationReadiness } from "../src/configuration/readiness.js";
import type { NordixConfig } from "../src/configuration/schema.js";
import {
  parseNordixYaml,
  stringifyNordixYaml,
  validateNordixConfig,
} from "../src/configuration/validate.js";
import { formatDiagnostic } from "../src/diagnostics.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";

const diagnostics = (input: unknown) => validateNordixConfig(input).diagnostics;
describe("YAML structure, references and descriptive diagnostics", () => {
  it.each(["single-module", "clean-modules", "mixed-modules"])(
    "validates and accepts generation of the approved %s example",
    (name) => {
      const config = targetConfig(name);
      expect(validateNordixConfig(config)).toMatchObject({ success: true, diagnostics: [] });
      expect(generationReadiness(resolvedFixture(config))).toEqual([]);
    },
  );

  it("keeps canonical YAML round trips and effective authentication defaults", () => {
    const config = targetConfig();
    const result = parseNordixYaml(stringifyNordixYaml(config));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config).toEqual(config);
    expect(
      result.config.endpoints.find((e) => e.operationId === "getCustomer")?.authRequired,
    ).toBeUndefined();
    expect(
      result.config.endpoints.find((e) => e.operationId === "listCustomers")?.authRequired,
    ).toBe(false);
    expect(result.config.endpoints[0]?.pagination).toBe("standard");
    expect(() => stringifyNordixYaml({ secret: "never-print" })).toThrow(/schemaVersion/);
  });

  it("attaches file, line and column to semantic and structural errors", () => {
    const config = targetConfig("single-module");
    config.backends[0].persistence.database = "missing";
    const source = stringify(config);
    const result = parseNordixYaml(source, "client.yaml");
    const error = result.diagnostics.find((d) => d.code === "UNKNOWN_BACKEND_DATABASE");
    const expectedLine =
      source.split("\n").findIndex((line) => line.includes("database: missing")) + 1;
    expect(error).toMatchObject({
      path: "backends[0].persistence.database",
      source: { file: "client.yaml", line: expectedLine },
    });
    expect(formatDiagnostic(error)).toContain(`client.yaml:${expectedLine}:`);
    const structure = parseNordixYaml("schemaVersion: 1\nname: sample\n", "version.yaml");
    expect(structure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CONFIG_VERSION_UNSUPPORTED",
        source: { file: "version.yaml", line: 1, column: 16 },
      }),
    );
    expect(diagnostics(config).every((d) => d.source === undefined)).toBe(true);
  });

  it.each([
    "name: broken\nversion: [\n",
    "name: duplicate\nname: private-secret-value\n",
    "? [complex, key]\n: value\n",
    "schemaVersion: 2\n<<: { name: merged }\n",
    "schemaVersion: 2\nname: !private secret-value\n",
    "schemaVersion: 2\nentities: &recursive { Example: *recursive }\n",
  ])("rejects malformed/unsafe YAML without exposing source values", (source) => {
    const result = parseNordixYaml(source, "invalid.yaml");
    expect(result.success).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.source).toMatchObject({ file: "invalid.yaml" });
    expect(JSON.stringify(result.diagnostics)).not.toContain("private-secret-value");
    expect(JSON.stringify(result.diagnostics)).not.toContain("secret-value");
  });

  it("rejects cyclic programmatic input and bounded alias expansion", () => {
    const input: Record<string, unknown> = {};
    input.self = input;
    expect(diagnostics(input)).toContainEqual(
      expect.objectContaining({ code: "CONFIG_DATA_CYCLE", path: "self" }),
    );
    const aliases =
      "a: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\n";
    expect(parseNordixYaml(aliases).diagnostics[0]?.code).toBe("YAML_CONVERSION_ERROR");
  });

  it("accepts ordinary acyclic aliases", () => {
    const source = stringify(targetConfig("single-module")).replace(
      "primary: {}",
      "primary: &resource {}\n  secondary: *resource",
    );
    expect(parseNordixYaml(source).success).toBe(true);
  });

  const cases: [string, (config: NordixConfig) => void, string][] = [
    [
      "missing owner",
      (c) => {
        c.backends[0].modules.customers.entities = ["CustomerAddress"];
      },
      "ENTITY_OWNER_MISSING",
    ],
    [
      "duplicate owners",
      (c) => {
        c.backends[0].modules.billing.entities.push("Customer");
      },
      "ENTITY_OWNER_DUPLICATE",
    ],
    [
      "unknown module entity",
      (c) => {
        c.backends[0].modules.billing.entities.push("Missing");
      },
      "UNKNOWN_MODULE_ENTITY",
    ],
    [
      "unknown producer",
      (c) => {
        c.backends[0].modules.billing.imports = { ghost: ["getCustomer"] };
      },
      "MODULE_IMPORT_UNKNOWN",
    ],
    [
      "private operation",
      (c) => {
        c.backends[0].modules.customers.exports = [];
      },
      "MODULE_IMPORT_NOT_EXPORTED",
    ],
    [
      "unknown export",
      (c) => {
        c.backends[0].modules.customers.exports = ["missingOperation"];
      },
      "MODULE_EXPORT_UNKNOWN",
    ],
    [
      "foreign export",
      (c) => {
        c.backends[0].modules.customers.exports = ["listInvoices"];
      },
      "MODULE_EXPORT_OWNER_MISMATCH",
    ],
    [
      "self import",
      (c) => {
        c.backends[0].modules.customers.imports = { customers: ["getCustomer"] };
      },
      "MODULE_IMPORT_SELF",
    ],
    [
      "cross-module relation",
      (c) => {
        c.entities.Invoice.relations.customer = {
          type: "many-to-one",
          target: "Customer",
          required: false,
        };
      },
      "CROSS_MODULE_RELATION",
    ],
    [
      "cross-module join",
      (c) => {
        c.endpoints.find((e) => e.operationId === "listInvoices").joins = [
          { entity: "Customer", type: "left", fields: ["name"] },
        ];
      },
      "CROSS_MODULE_JOIN",
    ],
    [
      "cross-module input",
      (c) => {
        c.endpoints.find((e) => e.operationId === "listInvoices").queryParams = [
          { name: "customer", required: false, field: { entity: "Customer", field: "name" } },
        ];
      },
      "CROSS_MODULE_FIELD_REFERENCE",
    ],
    [
      "duplicate operation",
      (c) => {
        c.endpoints[1].operationId = c.endpoints[0].operationId;
      },
      "DUPLICATE_OPERATION_ID",
    ],
    [
      "duplicate route shape",
      (c) => {
        c.endpoints.push({
          ...c.endpoints[1],
          operationId: "otherLookup",
          path: "/api/customers/{other}",
          pathParams: [{ name: "other", required: true, type: "uuid" }],
        });
      },
      "DUPLICATE_ENDPOINT",
    ],
    [
      "missing pagination",
      (c) => {
        c.endpoints[0].pagination = "unknown";
      },
      "UNKNOWN_PAGINATION_PROFILE",
    ],
    [
      "page input collision",
      (c) => {
        c.endpoints[0].queryParams.push({ name: "page", type: "number", required: false });
      },
      "PAGINATION_PARAMETER_CONFLICT",
    ],
    [
      "invalid page limits",
      (c) => {
        c.pagination.standard.maxPageSize = 1;
      },
      "PAGINATION_PROFILE_INVALID",
    ],
    [
      "unguarded write",
      (c) => {
        const e = c.endpoints.find((e) => e.operationId === "deleteCustomer");
        e.path = "/api/customers";
        e.pathParams = [];
      },
      "MUTATION_GUARD_REQUIRED",
    ],
    [
      "invalid body method",
      (c) => {
        c.endpoints[0].requestBody = { title: { type: "string", required: true, unique: false } };
      },
      "REQUEST_BODY_METHOD_INVALID",
    ],
    [
      "ambiguous parameter type",
      (c) => {
        c.endpoints[1].pathParams[0].type = "uuid";
      },
      "PARAMETER_TYPE_INVALID",
    ],
    [
      "incorrect placeholder",
      (c) => {
        c.endpoints[1].pathParams[0].name = "different";
      },
      "ENDPOINT_PATH_PARAMETERS_INVALID",
    ],
    [
      "unknown field",
      (c) => {
        c.endpoints[1].pathParams[0].field.field = "missing";
      },
      "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
    ],
    [
      "unknown main entity",
      (c) => {
        c.endpoints[1].entity = "Missing";
      },
      "UNKNOWN_ENDPOINT_ENTITY",
    ],
    [
      "reserved route",
      (c) => {
        c.endpoints[0].path = "/api/auth/sign-in";
      },
      "PLATFORM_ROUTE_RESERVED",
    ],
    [
      "generated field override",
      (c) => {
        c.entities.Customer.fields.id = { type: "uuid", required: true, unique: true };
      },
      "RESERVED_GENERATED_FIELD",
    ],
    [
      "invalid enum default",
      (c) => {
        c.entities.Customer.fields.status = {
          type: "enum",
          enumName: "Status",
          required: true,
          unique: false,
          default: "BAD",
        };
        c.enums.Status = ["GOOD"];
      },
      "INVALID_FIELD_DEFAULT",
    ],
    [
      "incompatible numeric constraints",
      (c) => {
        c.entities.Invoice.fields.total = {
          type: "number",
          format: "integer",
          precision: 2,
          scale: 3,
          required: true,
          unique: false,
        };
      },
      "FIELD_CONSTRAINT_INVALID",
    ],
    [
      "invalid required null",
      (c) => {
        c.entities.Customer.fields.name.default = null;
      },
      "INVALID_FIELD_DEFAULT",
    ],
    [
      "missing inverse",
      (c) => {
        c.entities.CustomerAddress.relations = {};
      },
      "RELATION_INVERSE_INVALID",
    ],
    [
      "unsafe required relation",
      (c) => {
        c.entities.CustomerAddress.relations.customer.onDelete = "set-null";
      },
      "INVALID_SET_NULL_RELATION",
    ],
  ];
  it.each(cases)("rejects %s with a specific actionable diagnostic", (_name, mutate, code) => {
    const config = targetConfig();
    mutate(config);
    const errors = diagnostics(config);
    expect(errors).toContainEqual(
      expect.objectContaining({
        code,
        severity: "error",
        path: expect.any(String),
        message: expect.stringMatching(/\w+.*[.!]/),
      }),
    );
  });

  it("reports actual module cycles separately from entity dependencies", () => {
    const config = targetConfig();
    config.backends[0].modules.billing.exports = ["listInvoices"];
    config.backends[0].modules.customers.imports = { billing: ["listInvoices"] };
    expect(diagnostics(config)).toContainEqual(
      expect.objectContaining({
        code: "MODULE_DEPENDENCY_CYCLE",
        message: expect.stringContaining("billing -> customers -> billing"),
      }),
    );
  });

  it("permits identical HTTP methods/paths on separate backends", () => {
    const config = targetConfig("single-module");
    config.backends.push({
      ...structuredClone(config.backends[0]),
      name: "second",
      path: "apps/second",
      persistence: undefined,
      modules: { other: { architecture: "clean", entities: ["Other"], exports: [], imports: {} } },
    });
    config.entities.Other = { ...structuredClone(config.entities.Note), backend: "second" };
    config.endpoints.push({
      ...structuredClone(config.endpoints[0]),
      backend: "second",
      entity: "Other",
      operationId: "listOther",
      queryParams: [],
    });
    expect(validateNordixConfig(config).success).toBe(true);
  });

  it("accumulates independent failures in deterministic order", () => {
    const config = targetConfig();
    config.backends[0].persistence.database = "unknown";
    config.frontends[0].connectsTo.push("ghost");
    config.entities.Invoice.fields.total.default = "not-a-number";
    const first = diagnostics(config);
    expect(first.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_BACKEND_DATABASE",
        "FRONTEND_BACKEND_UNKNOWN",
        "INVALID_FIELD_DEFAULT",
      ]),
    );
    expect(diagnostics(config)).toEqual(first);
  });
});
