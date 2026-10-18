import { describe, expect, it } from "vitest";
import type { NordixConfig } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { targetConfig } from "./fixtures.js";

describe("explicit operation inputs and route mappings", () => {
  const cases: [string, (c: NordixConfig) => void, string][] = [
    [
      "reserved operation symbol",
      (c) => {
        c.endpoints[0].operationId = "delete";
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "case-insensitive operation conflict",
      (c) => {
        c.endpoints[1].operationId = "listCUSTOMERS";
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "unknown backend",
      (c) => {
        c.endpoints[0].backend = "missing";
      },
      "UNKNOWN_ENDPOINT_BACKEND",
    ],
    [
      "noncanonical route",
      (c) => {
        c.endpoints[0].path = "/api//customers/";
      },
      "ENDPOINT_PATH_INVALID",
    ],
    [
      "duplicate input binding",
      (c) => {
        c.endpoints[0].queryParams.push(structuredClone(c.endpoints[0].queryParams[0]));
      },
      "OPERATION_INPUT_COLLISION",
    ],
    [
      "untyped parameter",
      (c) => {
        c.endpoints[0].queryParams = [{ name: "search", required: false }];
      },
      "PARAMETER_TYPE_INVALID",
    ],
    [
      "missing enum reference",
      (c) => {
        c.endpoints[0].queryParams = [
          { name: "search", type: "enum", enumName: "Missing", required: false },
        ];
      },
      "UNKNOWN_PARAMETER_ENUM",
    ],
    [
      "enumName on non-enum",
      (c) => {
        c.endpoints[0].queryParams[0].enumName = "Status";
      },
      "PARAMETER_TYPE_INVALID",
    ],
    [
      "operator without SQL binding",
      (c) => {
        c.endpoints[0].queryParams = [
          { name: "search", type: "string", operator: "eq", required: false },
        ];
      },
      "QUERY_OPERATOR_INVALID",
    ],
    [
      "numeric contains",
      (c) => {
        c.endpoints[5].queryParams = [
          {
            name: "search",
            field: { entity: "Invoice", field: "total" },
            operator: "contains",
            required: false,
          },
        ];
      },
      "QUERY_OPERATOR_INVALID",
    ],
    [
      "ordered string comparison",
      (c) => {
        c.endpoints[0].queryParams[0].operator = "gt";
      },
      "QUERY_OPERATOR_INVALID",
    ],
    [
      "related filter without join",
      (c) => {
        c.endpoints[0].joins = [];
        c.endpoints[0].queryParams[0].field = { entity: "CustomerAddress", field: "street" };
      },
      "QUERY_JOIN_REQUIRED",
    ],
    [
      "duplicate join",
      (c) => {
        c.endpoints[0].joins.push(structuredClone(c.endpoints[0].joins[0]));
      },
      "DUPLICATE_JOIN",
    ],
    [
      "unknown joined entity",
      (c) => {
        c.endpoints[0].joins[0].entity = "Missing";
      },
      "UNKNOWN_JOIN_ENTITY",
    ],
    [
      "unknown projection field",
      (c) => {
        c.endpoints[0].joins[0].fields = ["missing"];
      },
      "UNKNOWN_JOIN_FIELD",
    ],
    [
      "join without a direct relation",
      (c) => {
        c.endpoints[0].joins[0].entity = "Customer";
      },
      "JOIN_RELATION_INVALID",
    ],
    [
      "body entity mismatch",
      (c) => {
        c.endpoints[2].requestBody = { useCase: { entity: "Invoice", operation: "create" } };
      },
      "REQUEST_BODY_ENTITY_MISMATCH",
    ],
    [
      "body operation mismatch",
      (c) => {
        c.endpoints[2].requestBody = { useCase: { entity: "Customer", operation: "update" } };
      },
      "REQUEST_BODY_OPERATION_METHOD_MISMATCH",
    ],
    [
      "body parameter collision",
      (c) => {
        c.endpoints[2].queryParams = [{ name: "name", type: "string", required: true }];
      },
      "OPERATION_INPUT_COLLISION",
    ],
    [
      "inline body binding across modules",
      (c) => {
        c.endpoints[2].requestBody = { invoice: { field: { entity: "Invoice", field: "id" } } };
      },
      "CROSS_MODULE_FIELD_REFERENCE",
    ],
    [
      "invalid inline default",
      (c) => {
        c.endpoints[2].requestBody = {
          number: { type: "number", required: true, unique: false, default: "bad" },
        };
      },
      "INVALID_FIELD_DEFAULT",
    ],
    [
      "mutation join",
      (c) => {
        c.endpoints[2].joins = structuredClone(c.endpoints[0].joins);
      },
      "OPERATION_MAPPING_UNSUPPORTED",
    ],
    [
      "pagination on single lookup",
      (c) => {
        c.endpoints[1].pagination = "standard";
      },
      "PAGINATION_REQUIRES_GET",
    ],
  ];
  it.each(cases)("rejects %s with a located explanation", (_name, mutate, code) => {
    const config = targetConfig();
    mutate(config);
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({
        code,
        path: expect.stringMatching(/^endpoints\[/),
        message: expect.stringMatching(/\w+.*[.!]/),
      }),
    );
  });
  it("rejects useCase as an inline body field instead of treating it as an operation", () => {
    const config = targetConfig();
    config.endpoints[2].requestBody = {
      useCase: { type: "string", required: true, unique: false },
    };
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          code: "CONFIG_FIELD_INVALID",
          path: "endpoints[2].requestBody.useCase",
        }),
      ],
    });
  });
  it("accepts inline body references, scalar parameters and compatible direct filters", () => {
    const config = targetConfig();
    config.endpoints[2].requestBody = {
      title: { field: { entity: "Customer", field: "name" } },
      metadata: { type: "json", required: false, unique: false },
    };
    config.endpoints[0].queryParams.push({
      name: "street",
      field: { entity: "CustomerAddress", field: "street" },
      operator: "eq",
      required: false,
    });
    config.endpoints[5].queryParams = [
      {
        name: "minimum",
        field: { entity: "Invoice", field: "total" },
        operator: "gte",
        required: false,
      },
      { name: "trace", type: "string", required: false },
    ];
    expect(validateNordixConfig(config)).toMatchObject({ success: true, diagnostics: [] });
  });
});
