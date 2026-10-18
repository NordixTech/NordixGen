import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { generationReadiness } from "../src/configuration/readiness.js";
import {
  resolveProject,
  resolveProjectYaml,
  serializeResolvedProject,
} from "../src/project/resolve.js";
import { ProjectModelError, backendView, frontendView, moduleView } from "../src/project/views.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";

describe("shared resolved project and boundary views", () => {
  it.each(["single-module", "clean-modules", "mixed-modules"])(
    "resolves %s without claiming generation readiness",
    (name) => {
      const project = resolvedFixture(targetConfig(name));
      expect(project.formatVersion).toBe(5);
      expect(generationReadiness(project)).toBe(project.readiness);
      expect(project.readiness.length).toBeGreaterThan(0);
      expect(Object.isFrozen(project.entities)).toBe(true);
      expect(Object.isFrozen(project.operations)).toBe(true);
    },
  );
  it("resolves ownership, references, shared identity and independent graphs once", () => {
    const project = resolvedFixture(targetConfig("mixed-modules"));
    const customer = project.entities.Customer;
    const operation = project.operations["api.customers.getCustomer"];
    const customers = moduleView(project, "api.customers");
    const billing = moduleView(project, "api.billing");
    expect(customers.entities).toContain(customer);
    expect(customers.exports).toContain(operation.application);
    expect(billing.imports[0]?.operations).toContain(operation.application);
    expect(billing.imports[0]?.moduleId).toBe("api.customers");
    expect(project.moduleOrder.indexOf("api.customers")).toBeLessThan(
      project.moduleOrder.indexOf("api.billing"),
    );
    expect(
      project.entityDependencies.some(
        (e) => e.dependent === "Invoice" && e.dependency === "Customer",
      ),
    ).toBe(false);
    expect(operation.application.input).toHaveProperty("customerId");
    expect(operation.application.input).not.toHaveProperty("path");
    expect(operation.access).toMatchObject({
      authenticated: true,
      authority: "api",
      permissions: ["customers:read"],
    });
    expect(backendView(project, "api").endpoints).toContain(operation);
    expect(frontendView(project, "web").identity).toBe(project.backends.api.identity);
    expect(frontendView(project, "web").identity).toBeDefined();
    expect(JSON.stringify(billing.imports)).not.toMatch(
      /foreignKey|column|relations|repository|drizzle|Hono/,
    );
  });
  it("resolves stored FK ownership and does not duplicate inverse edges", () => {
    const project = resolvedFixture(targetConfig());
    const child = project.entities.CustomerAddress;
    const parent = project.entities.Customer;
    expect(child.fields.customerId).toMatchObject({
      type: "uuid",
      required: true,
      nullable: false,
      column: "customer_id",
      writable: true,
    });
    expect(child.relations.customer).toMatchObject({
      foreignKey: "customerId",
      foreignKeyEntity: "CustomerAddress",
      targetId: parent.id,
      onDelete: "cascade",
    });
    expect(parent.relations.addresses).toMatchObject({
      foreignKey: "customerId",
      foreignKeyEntity: "CustomerAddress",
      cardinality: "many",
      onDelete: "cascade",
    });
    expect(
      project.entityDependencies.filter(
        (edge) => edge.dependency === "Customer" && edge.dependent === "CustomerAddress",
      ),
    ).toHaveLength(1);
    expect(project.entityOrder.indexOf("Customer")).toBeLessThan(
      project.entityOrder.indexOf("CustomerAddress"),
    );
  });
  it("separates generated fields, writable fields, presence, nullability and dates", () => {
    const project = resolvedFixture(targetConfig());
    const customer = project.entities.Customer;
    expect(customer.generatedFields).toEqual(["createdAt", "deletedAt", "id", "updatedAt"]);
    expect(customer.fields.id).toMatchObject({
      generated: "identity",
      createOptional: true,
      writable: false,
      nullable: false,
    });
    const create = project.operations["api.customers.createCustomer"];
    const update = project.operations["api.customers.updateCustomer"];
    expect(Object.keys(create.body.fields)).toEqual(["email", "name"]);
    expect(create.body.fields.name).toMatchObject({ optional: false, nullable: false });
    expect(update.body.fields.name).toMatchObject({ optional: true, nullable: false });
    const invoice = project.entities.Invoice;
    expect(invoice.fields.note).toMatchObject({ nullable: true, createOptional: true });
    expect(invoice.fields.issuedAt).toMatchObject({
      value: { applicationType: "Date", transportType: "string", serialization: "utc-iso-instant" },
      defaultValue: { kind: "clock" },
    });
    const frontend = frontendView(project, "web");
    expect(frontend.entities.Invoice?.fields.issuedAt.value).toMatchObject({
      transportType: "string",
    });
    expect(frontend.entities.Invoice?.fields.issuedAt.value).not.toHaveProperty("applicationType");
    expect(JSON.stringify(frontend.endpoints)).not.toMatch(
      /"column"|"foreignKey"|"targetId"|"table"|"applicationType"/,
    );
  });
  it("resolves pagination, transport joins and page access without later lookups", () => {
    const project = resolvedFixture(targetConfig());
    const operation = project.operations["api.customers.listCustomers"];
    expect(operation.pagination).toMatchObject({
      profile: "standard",
      defaultPageSize: 20,
      maxPageSize: 80,
      origin: { path: "pagination.standard" },
    });
    expect(operation.input.page).toMatchObject({
      from: "pagination",
      optional: true,
      definition: { defaultValue: { kind: "literal", value: 1 } },
    });
    expect(operation.response.joins[0]).toMatchObject({
      cardinality: "many",
      nullable: false,
      projection: { street: project.entities.CustomerAddress.fields.street },
    });
    const frontend = frontendView(project, "web");
    expect(frontend.entities).not.toHaveProperty("CustomerAddress");
    expect(
      frontend.endpoints.find((op) => op.operationId === "listCustomers")?.response.joins[0]
        ?.projection,
    ).not.toHaveProperty("customerId");
    expect(frontend.pages).toEqual(
      expect.arrayContaining([
        { path: "/", authenticated: false },
        { path: "/customer", authenticated: false },
        { path: "/invoice", authenticated: true },
        { path: "/sign-in", authenticated: false },
      ]),
    );
  });
  it("does not mutate callers and freezes shared data against consumer drift", () => {
    const config = targetConfig();
    const before = structuredClone(config);
    const project = resolvedFixture(config);
    expect(config).toEqual(before);
    config.entities.Customer.fields.name.description = "caller changed";
    expect(project.entities.Customer.fields.name.description).toBeUndefined();
    expect(() => {
      (project.entities.Customer.fields.name as { required: boolean }).required = false;
    }).toThrow(TypeError);
    expect(() => {
      (project.entities.Invoice.fields.issuedAt.default as { kind: string }).kind = "changed";
    }).toThrow(TypeError);
    expect(project.repositories[0]).toBe(project.backends.api.repository);
    expect(project.databases.primary).toBe(project.backends.api.database);
  });
  it("preserves source coordinates through resolution and the common readiness boundary", () => {
    const config = targetConfig();
    config.backends[0].modules.billing.architecture = "hexagonal";
    const source = stringify(config);
    const result = resolveProjectYaml(source, "client.yaml");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.entities.Customer.fields.name.origin.source?.file).toBe("client.yaml");
    expect(
      result.project.operations["api.customers.listCustomers"].pagination?.origin.source?.line,
    ).toBeGreaterThan(0);
    const ready = resolveProjectYaml(source, "client.yaml", { requireGeneration: true });
    expect(ready.success).toBe(false);
    const unsupported = ready.diagnostics.find(
      (d) => d.code === "MODULE_ARCHITECTURE_UNIMPLEMENTED",
    );
    const line =
      source.split("\n").findIndex((line) => line.includes("architecture: hexagonal")) + 1;
    expect(unsupported).toMatchObject({
      path: "backends[0].modules.billing.architecture",
      source: { file: "client.yaml", line },
    });
  });
  it("rejects stored FK cycles with the actual cycle and its source while leaving module order separate", () => {
    const config = targetConfig();
    config.entities.Customer.relations.addresses = {
      type: "many-to-one",
      target: "CustomerAddress",
      required: false,
    };
    const source = stringify(config);
    const result = resolveProjectYaml(source, "cycle.yaml");
    expect(result).toMatchObject({
      success: false,
      diagnostics: [
        expect.objectContaining({
          code: "RELATION_CYCLE",
          path: expect.stringMatching(/^entities\./),
          source: expect.objectContaining({ file: "cycle.yaml" }),
          message: expect.stringMatching(/Customer -> CustomerAddress -> Customer/),
        }),
      ],
    });
    expect(
      resolveProject(config, { requireGeneration: true }).diagnostics.map((d) => d.code),
    ).toEqual(["RELATION_CYCLE"]);
  });
  it("preserves specific configuration errors and does not invent view targets", () => {
    expect(resolveProject({ schemaVersion: 1 }).diagnostics).toContainEqual(
      expect.objectContaining({ code: "CONFIG_VERSION_UNSUPPORTED" }),
    );
    expect(resolveProjectYaml("name: [\n").diagnostics[0]?.code).toBe("YAML_SYNTAX_ERROR");
    const project = resolvedFixture(targetConfig());
    for (const run of [
      () => backendView(project, "missing"),
      () => moduleView(project, "missing"),
      () => frontendView(project, "missing"),
    ])
      expect(run).toThrow(ProjectModelError);
  });
  it("orders specific static routes before parameter routes independently of declaration order", () => {
    const config = targetConfig("single-module");
    const base = structuredClone(config.endpoints[0]);
    config.endpoints = [
      {
        ...base,
        operationId: "getNote",
        path: "/api/notes/{id}",
        pagination: undefined,
        queryParams: [],
        pathParams: [{ name: "id", field: { entity: "Note", field: "id" }, required: true }],
      },
      { ...base, operationId: "newNotes", path: "/api/notes/new" },
      base,
    ];
    const project = resolvedFixture(config);
    expect(backendView(project, "api").endpoints.map((operation) => operation.path)).toEqual([
      "/api/notes/new",
      "/api/notes",
      "/api/notes/{id}",
    ]);
  });
  it("serializes canonical mappings without reordering meaningful enum/default arrays", () => {
    const first = targetConfig();
    first.entities.Customer.fields.data = {
      type: "json",
      required: false,
      unique: false,
      default: { z: 1, a: [3, 2] },
    };
    first.enums.Status = ["second", "first"];
    const second = structuredClone(first);
    second.entities = Object.fromEntries(Object.entries(second.entities).reverse());
    second.entities.Customer.fields.data.default = { a: [3, 2], z: 1 };
    expect(serializeResolvedProject(resolvedFixture(first))).toBe(
      serializeResolvedProject(resolvedFixture(second)),
    );
    expect(resolvedFixture(first).enums.Status).toEqual(["second", "first"]);
  });
});
