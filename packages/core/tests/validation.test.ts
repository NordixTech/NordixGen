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

  it("parses a representative YAML document and orders its entity dependencies", () => {
    const result = parseNordixYaml(comprehensiveYaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const entityOrder = buildIntermediateRepresentation(result.config).entityOrder;
    expect(entityOrder.indexOf("User")).toBeLessThan(entityOrder.indexOf("Order"));
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
      dateNowValue: { type: "date", default: { kind: "now" } },
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

  it("validates repository and organization declarations while allowing flexible topology", () => {
    const flexible = createValidConfig();
    const flexibleFrontend = flexible.frontends[0];
    const flexibleRepository = flexible.repositories[0];
    if (!flexibleFrontend || !flexibleRepository) throw new Error("Fixture is incomplete.");
    flexibleFrontend.connectsTo = ["core-api", "worker-notifications"];
    flexibleRepository.path = "repos/commerce";
    flexible.repositories.push({ name: "notifications", path: "repos/notifications" });
    flexible.frontends.push({
      name: "standalone-web",
      framework: "nextjs",
      path: ".",
      repository: "commerce",
      connectsTo: [],
    });
    flexible.backends.push({
      name: "worker-notifications",
      framework: "hono",
      path: "apps/notifications",
      repository: "commerce",
    });
    expect(validateNordixConfig(flexible).success).toBe(true);

    const rootRepository = createValidConfig();
    rootRepository.repositories.push({ name: "nested-repo", path: "packages/nested" });
    expect(validateNordixConfig(rootRepository).diagnostics.map((item) => item.code)).toContain(
      "NESTED_REPOSITORY_PATH",
    );

    const invalid = createValidConfig();
    invalid.organizations.push({ name: "nordix", provider: "github", handle: "NordixTech" });
    const invalidRepository = invalid.repositories[0];
    if (!invalidRepository) throw new Error("Fixture is incomplete.");
    invalidRepository.path = "repos/commerce";
    invalid.repositories.push(
      { name: "commerce", path: "repos/commerce", organization: "missing" },
      { name: "nested", path: "repos/commerce/nested" },
      { name: "remote-without-org", path: "repos/remote", createRemote: true },
    );
    invalid.frontends.push({
      name: "store-web",
      framework: "nextjs",
      path: "../outside",
      repository: "missing-repository",
    });
    const codes = validateNordixConfig(invalid).diagnostics.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ORGANIZATION",
        "DUPLICATE_REPOSITORY",
        "DUPLICATE_REPOSITORY_PATH",
        "NESTED_REPOSITORY_PATH",
        "UNKNOWN_REPOSITORY_ORGANIZATION",
        "REMOTE_REPOSITORY_WITHOUT_ORGANIZATION",
        "UNKNOWN_APP_REPOSITORY",
        "DUPLICATE_APP_NAME",
        "UNSAFE_APP_PATH",
      ]),
    );
  });

  it("checks backend ownership for entities, relations, endpoints, and joins", () => {
    const config = createValidConfig();
    config.entities.OrderItem.backend = "other-api";
    const endpoint = config.endpoints[0];
    if (!endpoint) throw new Error("Fixture is incomplete.");
    endpoint.backend = "unknown-api";
    const codes = validateNordixConfig(config).diagnostics.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "CROSS_BACKEND_RELATION",
        "UNKNOWN_ENDPOINT_BACKEND",
        "ENDPOINT_ENTITY_BACKEND_MISMATCH",
        "CROSS_BACKEND_JOIN",
      ]),
    );
  });

  it("supports the singular backend form when resolving entity ownership", () => {
    const result = validateNordixConfig({
      name: "single-backend",
      version: "1.0.0",
      repositories: [{ name: "app", path: "." }],
      backend: { framework: "hono", path: "apps/api", repository: "app" },
      entities: { User: { backend: "backend" } },
    });
    expect(result.success).toBe(true);
  });

  it("validates endpoint entities, roles, duplicate routes, join projections, and enum parameters", () => {
    const config = createValidConfig();
    const originalEndpoint = config.endpoints[0];
    if (!originalEndpoint) throw new Error("Fixture is incomplete.");
    originalEndpoint.path = "/api/orders/summary/{status}";
    originalEndpoint.pathParams = [{ name: "status", field: { entity: "Order", field: "status" } }];
    config.endpoints.push({
      path: "/api/orders/summary/{status}",
      method: "GET",
      backend: "core-api",
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
      {
        name: "core-api",
        framework: "hono",
        path: "apps/api",
        repository: "commerce",
        auth: { type: "none" },
      },
    ];
    const endpoint = config.endpoints[0] as {
      backend: string;
      roles: string[];
      permissions: string[];
    };
    endpoint.backend = "core-api";
    endpoint.roles = ["admin"];
    endpoint.permissions = ["orders:read"];
    expect(validateNordixConfig(config).diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_ENDPOINT_ROLE", "UNKNOWN_ENDPOINT_PERMISSION"]),
    );
  });
  it("validates endpoint field bindings, operation reuse, pagination, and body references", () => {
    const config = createValidConfig();
    const summary = config.endpoints[0];
    if (!summary) throw new Error("Fixture endpoint is missing.");
    summary.operationId = "readOrders";
    summary.pagination = { strategy: "offset" };
    summary.queryParams = [
      { name: "badType", field: { entity: "Order", field: "status" }, type: "string" },
      { name: "missing", field: { entity: "Order", field: "missing" } },
      { name: "orderDeleted", field: { entity: "Order", field: "isDeleted" } },
      { name: "userDeletedAt", field: { entity: "User", field: "deletedAt" } },
      { name: "userUpdatedAt", field: { entity: "User", field: "updatedAt" } },
      { name: "wrongEnum", field: { entity: "Order", field: "status" }, enumName: "UserRole" },
      { name: "externalValue", field: { entity: "External", field: "value" } },
      { name: "missingEntity", field: { entity: "Missing", field: "value" } },
    ];
    config.backends.push({
      name: "other-api",
      framework: "hono",
      repository: "commerce",
      path: "apps/other-api",
    });
    config.entities.External = { backend: "other-api", fields: { value: { type: "string" } } };
    config.endpoints.push({
      backend: "core-api",
      path: "/api/orders/{orderId}",
      method: "GET",
      operationId: "readOrders",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [{ name: "orderId", field: { entity: "Order", field: "id" } }],
      joins: [],
    });
    config.endpoints.push({
      backend: "core-api",
      path: "/api/orders/custom",
      method: "POST",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [{ name: "page", type: "number" }],
      pathParams: [],
      pagination: { strategy: "offset", pageParam: "page" },
      requestBody: { useCase: { entity: "User", operation: "update" } },
      joins: [],
    });
    config.endpoints.push({
      backend: "core-api",
      path: "/api/orders/body",
      method: "PATCH",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      requestBody: {
        orderStatus: { field: { entity: "Order", field: "status" } },
        unknownField: { field: { entity: "Order", field: "unknown" } },
        externalValue: { field: { entity: "External", field: "value" } },
        freeText: { type: "string" },
      },
      joins: [],
    });
    config.endpoints.push({
      backend: "core-api",
      path: "/api/orders/create-body-mismatch",
      method: "PATCH",
      entity: "Order",
      authRequired: false,
      roles: [],
      permissions: [],
      queryParams: [],
      pathParams: [],
      requestBody: { useCase: { entity: "Order", operation: "create" } },
      joins: [],
    });
    const codes = validateNordixConfig(config).diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_OPERATION_ID",
        "ENDPOINT_FIELD_TYPE_MISMATCH",
        "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
        "PAGINATION_REQUIRES_GET",
        "PAGINATION_PARAMETER_CONFLICT",
        "CROSS_BACKEND_FIELD_REFERENCE",
        "ENDPOINT_FIELD_ENUM_MISMATCH",
        "UNKNOWN_REQUEST_BODY_ENTITY",
        "REQUEST_BODY_OPERATION_METHOD_MISMATCH",
      ]),
    );
  });
});
