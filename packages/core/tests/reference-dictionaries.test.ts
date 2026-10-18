import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { NordixConfig } from "../src/configuration/schema.js";
import {
  buildFrontendApiContract,
  frontendRenderSettings,
} from "../src/plugins/frontend-api-contract.js";
import { betterAuthFrontendPlugin } from "../src/plugins/frontends/better-auth-client.js";
import { nextjsFrontendPlugin } from "../src/plugins/frontends/nextjs.js";
import { resolveProject } from "../src/project/resolve.js";
import { ProjectModelError, backendView, frontendView, moduleView } from "../src/project/views.js";
import { createValidConfig, resolvedFixture, targetConfig } from "./fixtures.js";

describe("own configuration references and immutable dictionary values", () => {
  const cases: [string, (c: NordixConfig) => void, string][] = [
    [
      "entity",
      (c) => {
        c.endpoints[0].entity = "constructor";
      },
      "UNKNOWN_ENDPOINT_ENTITY",
    ],
    [
      "module owner",
      (c) => {
        c.backends[0].modules.notes.entities.push("constructor");
      },
      "UNKNOWN_MODULE_ENTITY",
    ],
    [
      "producer module",
      (c) => {
        c.backends[0].modules.notes.imports.constructor = ["listNotes"];
      },
      "MODULE_IMPORT_UNKNOWN",
    ],
    [
      "relationship target",
      (c) => {
        c.entities.Note.relations.related = {
          type: "many-to-one",
          target: "constructor",
          required: false,
        };
      },
      "UNKNOWN_RELATION_TARGET",
    ],
    [
      "field binding",
      (c) => {
        c.endpoints[0].queryParams = [
          { name: "search", field: { entity: "Note", field: "constructor" }, required: false },
        ];
      },
      "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
    ],
    [
      "entity in a field binding",
      (c) => {
        c.endpoints[0].queryParams = [
          {
            name: "search",
            field: { entity: "constructor", field: "constructor" },
            required: false,
          },
        ];
      },
      "UNKNOWN_ENDPOINT_FIELD_REFERENCE",
    ],
    [
      "enum",
      (c) => {
        c.entities.Note.fields.state = {
          type: "enum",
          enumName: "constructor",
          required: true,
          unique: false,
          default: "one",
        };
      },
      "UNKNOWN_ENUM",
    ],
    [
      "parameter enum",
      (c) => {
        c.endpoints[0].queryParams = [
          { name: "search", type: "enum", enumName: "constructor", required: false },
        ];
      },
      "UNKNOWN_PARAMETER_ENUM",
    ],
    [
      "pagination",
      (c) => {
        c.endpoints[0].pagination = "constructor";
      },
      "UNKNOWN_PAGINATION_PROFILE",
    ],
  ];
  it.each(cases)(
    "reports an unknown %s without treating an inherited property as data",
    (_name, mutate, code) => {
      const config = targetConfig("single-module");
      mutate(config);
      expect(resolveProject(config)).toMatchObject({
        success: false,
        diagnostics: expect.arrayContaining([expect.objectContaining({ code })]),
      });
    },
  );
  it("preserves explicitly declared names and does not freeze caller-owned defaults", () => {
    const config = createValidConfig();
    const literal = { constructor: "business value", nested: { z: 2, a: 1 } };
    Object.assign(config.entities.Customer.fields, {
      constructor: { type: "string" },
      toString: { type: "boolean", default: false },
      profile: { type: "json", default: literal },
    });
    config.endpoints.push({
      backend: "core-api",
      entity: "Customer",
      operationId: "customCustomer",
      method: "POST",
      path: "/customers/custom",
      requestBody: { metadata: { type: "json", default: literal } },
    });
    const project = resolvedFixture(config);
    expect(project.entities.Customer.fields.constructor).toMatchObject({
      generated: false,
      writable: true,
      type: "string",
    });
    expect(project.entities.Customer.fields.toString).toMatchObject({
      generated: false,
      writable: true,
      type: "boolean",
    });
    expect(Object.getPrototypeOf(config.entities)).toBe(Object.prototype);
    expect(Object.isFrozen(literal)).toBe(false);
    literal.constructor = "caller changed";
    expect(project.entities.Customer.fields.profile.default).toMatchObject({
      constructor: "business value",
    });
    expect(
      Object.values(project.operations).find(
        (operation) => operation.operationId === "customCustomer",
      )?.body.fields.metadata.definition.default,
    ).toMatchObject({ constructor: "business value" });
    expect(project.frontends["store-web"].entities.constructor).toBeUndefined();
    expect(project.entities.constructor).toBeUndefined();
  });
  it("does not return inherited functions for unknown model view targets", () => {
    const project = resolvedFixture(targetConfig());
    for (const name of ["constructor", "toString", "hasOwnProperty"])
      for (const view of [backendView, moduleView, frontendView])
        expect(() => view(project, name)).toThrow(ProjectModelError);
  });
  it("executes generated presentation permissions without inheriting undeclared role grants", async () => {
    const project = resolvedFixture(targetConfig());
    const frontend = frontendRenderSettings(project, "web");
    const framework = nextjsFrontendPlugin.createFrameworkContext?.(frontend);
    if (!framework) throw new Error("Missing frontend framework");
    const files = betterAuthFrontendPlugin.contribute({
      projectName: "Shop",
      frontend,
      framework,
      api: buildFrontendApiContract(project, "web"),
      availableCapabilities: new Set(),
    });
    const source = files.find((file) => file.path.endsWith("/permissions.ts"))?.content;
    if (!source) throw new Error("Missing presentation policy");
    const javascript = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText;
    const policy = await import(
      `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
    );
    expect(policy.hasPermission({ id: "verified", role: "admin" }, "customers:read")).toBe(true);
    for (const role of ["constructor", "toString", "hasOwnProperty"])
      expect(policy.hasPermission({ id: "verified", role }, "customers:read")).toBe(false);
  });
});
