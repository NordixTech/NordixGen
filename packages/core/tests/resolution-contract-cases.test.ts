import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { NordixConfig } from "../src/configuration/schema.js";
import { generateBackend } from "../src/generation/backend.js";
import { resolveProject, resolveProjectYaml } from "../src/project/resolve.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";

function twoBackends() {
  const config = targetConfig("single-module");
  config.backends.push({
    ...structuredClone(config.backends[0]),
    name: "other-api",
    path: "apps/other",
    modules: { notes: { architecture: "clean", entities: ["Other"], imports: {}, exports: [] } },
  });
  config.entities.Other = { ...structuredClone(config.entities.Note), backend: "other-api" };
  config.endpoints.push({
    ...structuredClone(config.endpoints[0]),
    backend: "other-api",
    entity: "Other",
    queryParams: [],
  });
  config.frontends = [
    {
      name: "web",
      repository: "app",
      path: "apps/web",
      connectsTo: ["api", "other-api"],
      access: { mode: "public" },
    },
  ];
  return config;
}
describe("resolved scopes, defaults and configuration failures", () => {
  it("refuses temporary renderer fallbacks and supports a resolved backend without persistence", () => {
    const config = targetConfig("single-module");
    config.backends[0].persistence = undefined;
    const project = resolvedFixture(config);
    expect(generateBackend(project, "api").success).toBe(true);
    expect(() => generateBackend(project, "missing")).toThrow("UNKNOWN_BACKEND_TARGET");
    config.backends[0].modules.notes.architecture = "onion";
    expect(generateBackend(resolvedFixture(config), "api")).toMatchObject({
      success: false,
      diagnostics: [expect.objectContaining({ code: "MODULE_ARCHITECTURE_UNIMPLEMENTED" })],
    });
    expect(generateBackend(resolvedFixture(targetConfig()), "api").success).toBe(false);
    config.backends[0].modules.notes.architecture = "clean";
    config.entities.Note.relations.tags = {
      type: "many-to-many",
      target: "Note",
      joinTable: "note_tags",
      required: false,
    };
    expect(generateBackend(resolvedFixture(config), "api")).toMatchObject({
      success: false,
      diagnostics: [expect.objectContaining({ code: "RELATION_MAPPING_UNIMPLEMENTED" })],
    });
  });
  it("retains metadata while resolving default inverse keys and public contract failure/context shapes", () => {
    const config = targetConfig();
    config.description = "Project description";
    config.entities.Customer.description = "Customer description";
    config.entities.Customer.relations.addresses.foreignKey = undefined;
    config.entities.CustomerAddress.relations.customer.foreignKey = undefined;
    config.endpoints[0].summary = "Find active customers";
    const project = resolvedFixture(config);
    expect(project.project.description).toBe("Project description");
    expect(project.entities.Customer.description).toBe("Customer description");
    expect(project.entities.Customer.relations.addresses.foreignKey).toBe("customer_id");
    expect(
      project.frontends.web.endpoints.find((operation) => operation.operationId === "listCustomers")
        ?.summary,
    ).toBe("Find active customers");
    const contract = project.operations["api.customers.getCustomer"].application;
    expect(contract.context).toEqual({ kind: "trusted-backend-context", backend: "api" });
    expect(contract.errors).toEqual([
      "validation",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "unexpected",
    ]);
    expect(contract).not.toHaveProperty("method");
    expect(contract).not.toHaveProperty("path");
  });
  it("qualifies shared operation IDs by backend without choosing a first authority", () => {
    const config = twoBackends();
    for (const backend of config.backends)
      backend.authentication = { methods: ["email-password"], identityProviders: [], features: [] };
    config.endpoints[0].authRequired = false;
    config.endpoints[1].authRequired = true;
    config.frontends[0].access = { mode: "authenticated", backend: "other-api" };
    const first = resolvedFixture(config);
    const names = Object.values(first.frontends.web.operationNames);
    expect(names).toEqual(expect.arrayContaining(["apiListNotes", "otherApiListNotes"]));
    expect(new Set(names).size).toBe(2);
    expect(first.frontends.web.identity).toBe(first.backends["other-api"].identity);
    expect(first.backends.api.identity).toMatchObject({
      roles: ["user"],
      defaultRole: "user",
      rolePermissions: {},
    });
    config.backends.reverse();
    config.frontends[0].connectsTo.reverse();
    expect(resolvedFixture(config).frontends.web.identity?.backend).toBe("other-api");
    config.frontends[0].access.backend = undefined;
    expect(resolveProject(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "FRONTEND_IDENTITY_AMBIGUOUS" }),
    );
  });
  it.each(["api--2-", "public-api", "api2"])(
    "uses safe qualified client names for backend %s",
    (name) => {
      const config = twoBackends();
      config.backends[1].name = name;
      config.entities.Other.backend = name;
      config.endpoints[1].backend = name;
      config.frontends[0].connectsTo[1] = name;
      const project = resolvedFixture(config);
      for (const value of Object.values(project.frontends.web.operationNames))
        expect(value).toMatch(/^[a-z][A-Za-z0-9]*$/);
    },
  );
  it("rejects qualified client-name collisions instead of silently suffixing exports", () => {
    const config = twoBackends();
    config.endpoints.push({
      ...structuredClone(config.endpoints[0]),
      operationId: "apiListNotes",
      path: "/extra",
    });
    expect(resolveProject(config)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "GENERATED_NAME_COLLISION",
          path: "frontends[0].connectsTo",
        }),
      ]),
    });
  });
  it("selects a sole authority automatically and preserves mixed subtree page rules", () => {
    const config = targetConfig();
    config.frontends[0].access.backend = undefined;
    config.frontends[0].access.publicRoutes = ["/", "/customer/**"];
    const project = resolvedFixture(config);
    expect(project.frontends.web.identity).toBe(project.backends.api.identity);
    expect(
      project.frontends.web.pages.find((page) => page.path === "/customer")?.authenticated,
    ).toBe(false);
    expect(
      project.frontends.web.pages.find((page) => page.path === "/invoice")?.authenticated,
    ).toBe(true);
    expect(
      project.frontends.web.endpoints.find(
        (operation) => operation.operationId === "deleteCustomer",
      )?.recordIdParameter,
    ).toBe("customerId");
  });
  it("makes generated names and numeric defaults consistent before rendering", () => {
    const config = targetConfig("single-module");
    Object.assign(config.entities.Note.fields, {
      data2D: { type: "number", format: "decimal", required: false, unique: false, default: null },
      count: { type: "number", format: "integer", required: true, unique: false, default: 1 },
      amount: { type: "number", precision: 6, required: true, unique: false },
    });
    config.enums.Status2D = ["second", "first"];
    const project = resolvedFixture(config);
    expect(project.entities.Note.fields.data2D).toMatchObject({
      column: "data2_d",
      format: "decimal",
      precision: 10,
      scale: 2,
      nullable: true,
      defaultValue: { kind: "literal", value: null },
    });
    expect(project.entities.Note.fields.count).toMatchObject({
      format: "integer",
      defaultValue: { kind: "literal", value: 1 },
    });
    expect(project.entities.Note.fields.amount).toMatchObject({
      format: "decimal",
      precision: 6,
      scale: 2,
    });
    expect(project.enumSqlNames.Status2D).toBe("status2_d_enum");
    expect(project.enums.Status2D).toEqual(["second", "first"]);
  });
  it("keeps body presence overrides separate from stored nullability and inherited defaults", () => {
    const config = targetConfig("single-module");
    config.entities.Note.fields.title.default = "Draft";
    config.entities.Note.fields.when = {
      type: "date",
      required: false,
      unique: false,
      default: "2024-01-01T03:00:00+03:00",
    };
    config.endpoints.push({
      ...structuredClone(config.endpoints[0]),
      operationId: "customNote",
      method: "POST",
      path: "/notes/custom",
      queryParams: [],
      pagination: undefined,
      requestBody: {
        requiredTitle: { field: { entity: "Note", field: "title" }, required: true },
        optionalTitle: { field: { entity: "Note", field: "title" }, required: false },
        requiredDate: { field: { entity: "Note", field: "when" }, required: true },
        inheritedDate: { field: { entity: "Note", field: "when" } },
        generatedId: { field: { entity: "Note", field: "id" } },
      },
    });
    const operation = Object.values(resolvedFixture(config).operations).find(
      (operation) => operation.operationId === "customNote",
    );
    expect(operation?.input.requiredTitle).toMatchObject({
      optional: false,
      nullable: false,
      definition: { defaultValue: { kind: "absent" } },
    });
    expect(operation?.input.optionalTitle).toMatchObject({
      optional: true,
      nullable: false,
      definition: { defaultValue: { kind: "literal", value: "Draft" } },
    });
    expect(operation?.input.requiredDate).toMatchObject({
      optional: false,
      nullable: true,
      definition: { defaultValue: { kind: "absent" } },
    });
    expect(operation?.input.inheritedDate.definition.default).toBe("2024-01-01T00:00:00.000Z");
    expect(operation?.input.generatedId).toMatchObject({
      optional: false,
      nullable: false,
      definition: { name: "generatedId", generated: false, writable: true },
    });
  });
  it("resolves implicit FK names, uniqueness and relationship-table metadata", () => {
    const config = targetConfig("single-module");
    config.backends[0].modules.notes.entities.push("Profile", "Tag");
    config.entities.Profile = {
      backend: "api",
      fields: {},
      relations: {},
      timestamps: { createdAt: false, updatedAt: false },
      softDelete: false,
    };
    config.entities.Tag = structuredClone(config.entities.Profile);
    config.entities.Note.relations.profile = {
      type: "one-to-one",
      target: "Profile",
      required: false,
    };
    config.entities.Note.relations.tags = { type: "many-to-many", target: "Tag", required: false };
    const project = resolvedFixture(config);
    expect(project.entities.Note.fields.profile_id).toMatchObject({
      type: "uuid",
      unique: true,
      required: false,
    });
    expect(project.entities.Note.relations.profile).toMatchObject({
      foreignKey: "profile_id",
      onDelete: "no-action",
      cardinality: "one",
    });
    expect(project.entities.Note.relations.tags).toMatchObject({
      joinTable: "note_tag",
      cardinality: "many",
    });
    expect(project.readiness).toContainEqual(
      expect.objectContaining({
        code: "RELATION_MAPPING_UNIMPLEMENTED",
        path: "entities.Note.relations.tags",
      }),
    );
    expect(project.entityDependencies).not.toContainEqual(
      expect.objectContaining({ dependency: "Tag", dependent: "Note" }),
    );
  });
  it("reports an actual stored cycle excluding an acyclic dependency", () => {
    const config = targetConfig("single-module");
    config.endpoints = [];
    config.entities = Object.fromEntries(
      ["A", "M", "Z", "Leaf"].map((name) => [
        name,
        {
          backend: "api",
          fields: {},
          relations: {},
          timestamps: { createdAt: false, updatedAt: false },
          softDelete: false,
        },
      ]),
    );
    config.backends[0].modules.notes.entities = Object.keys(config.entities);
    config.entities.A.relations = {
      leaf: { type: "many-to-one", target: "Leaf", required: false },
      middle: { type: "many-to-one", target: "M", required: false },
    };
    config.entities.M.relations = {
      leaf: { type: "many-to-one", target: "Leaf", required: false },
      end: { type: "many-to-one", target: "Z", required: false },
    };
    config.entities.Z.relations = { start: { type: "many-to-one", target: "A", required: false } };
    const error = resolveProject(config).diagnostics[0];
    expect(error).toMatchObject({
      code: "RELATION_CYCLE",
      message: expect.stringContaining("A -> M -> Z -> A"),
    });
    expect(error?.message).not.toContain("Leaf");
    config.entities.A.relations = { self: { type: "many-to-one", target: "A", required: false } };
    expect(resolveProject(config).diagnostics[0]?.message).toContain("A -> A");
  });
  const invalid: [string, (c: NordixConfig) => void, string][] = [
    [
      "duplicate set members",
      (c) => {
        c.backends[0].modules.notes.entities.push("Note");
      },
      "CONFIG_FIELD_INVALID",
    ],
    [
      "empty module ownership",
      (c) => {
        c.backends[0].modules.notes.entities = [];
      },
      "CONFIG_FIELD_INVALID",
    ],
    [
      "unsupported architecture spelling",
      (c) => {
        c.backends[0].modules.notes.architecture = "hexagon" as never;
      },
      "MODULE_ARCHITECTURE_INVALID",
    ],
    [
      "unsupported HTTP method",
      (c) => {
        c.endpoints[0].method = "TRACE" as never;
      },
      "CONFIG_VALUE_UNSUPPORTED",
    ],
    [
      "optional path binding",
      (c) => {
        c.endpoints[0].path = "/notes/{id}";
        c.endpoints[0].pathParams = [{ name: "id", type: "uuid", required: false as never }];
      },
      "CONFIG_VALUE_UNSUPPORTED",
    ],
    [
      "unsupported soft-delete union",
      (c) => {
        c.entities.Note.softDelete = "never" as never;
      },
      "CONFIG_FIELD_INVALID",
    ],
    [
      "unsupported field type",
      (c) => {
        c.entities.Note.fields.title.type = "xml" as never;
      },
      "CONFIG_VALUE_UNSUPPORTED",
    ],
    [
      "numeric minimum",
      (c) => {
        c.entities.Note.fields.title = {
          type: "number",
          precision: 0,
          required: true,
          unique: false,
        };
      },
      "CONFIG_FIELD_INVALID",
    ],
    [
      "invalid operation ID format",
      (c) => {
        c.endpoints[0].operationId = "invalid-name";
      },
      "CONFIG_FIELD_INVALID",
    ],
    [
      "unknown body field reference",
      (c) => {
        c.endpoints[0].method = "POST";
        c.endpoints[0].pagination = undefined;
        c.endpoints[0].requestBody = { title: { field: { entity: "Note", field: "missing" } } };
      },
      "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
    ],
  ];
  it.each(invalid)(
    "preserves specific diagnostics for %s in both resolution modes",
    (_name, mutate, code) => {
      const config = targetConfig("single-module");
      mutate(config);
      const source = stringify(config);
      const validation = resolveProjectYaml(source, "invalid.yaml");
      const generation = resolveProjectYaml(source, "invalid.yaml", { requireGeneration: true });
      expect(validation.success).toBe(false);
      expect(generation.diagnostics).toEqual(validation.diagnostics);
      expect(validation.diagnostics).toContainEqual(
        expect.objectContaining({
          code,
          path: expect.any(String),
          source: expect.objectContaining({ file: "invalid.yaml" }),
        }),
      );
    },
  );
  it("bounds excessive data before resolution and retains corrective paths", () => {
    const deep: Record<string, unknown> = {};
    let current = deep;
    for (let index = 0; index < 82; index++) {
      const next = {};
      current.child = next;
      current = next;
    }
    expect(resolveProject(deep).diagnostics[0]).toMatchObject({
      code: "CONFIG_DATA_LIMIT",
      message: expect.stringContaining("Simplify"),
    });
    expect(resolveProject({ values: Array(100001).fill(0) }).diagnostics[0]?.code).toBe(
      "CONFIG_DATA_LIMIT",
    );
  });
});
