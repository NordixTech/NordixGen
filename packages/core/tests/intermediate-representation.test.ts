import { describe, expect, it } from "vitest";
import {
  NordixConfigError,
  buildIntermediateRepresentation,
  serializeIntermediateRepresentation,
  sortEntitiesTopologically,
} from "../src/intermediate-representation.js";
import { createValidConfig } from "./fixtures.js";

describe("Nordix Intermediate Representation", () => {
  it("normalizes project configuration, injects generated fields, and orders dependencies", () => {
    const ir = buildIntermediateRepresentation(createValidConfig());
    expect(ir.formatVersion).toBe(1);
    expect(ir.entityOrder).toEqual(["User", "Order", "OrderItem"]);
    expect(Object.keys(ir.entities)).toEqual(["Order", "OrderItem", "User"]);
    expect(ir.entities.User?.fields).toHaveProperty("id", {
      type: "uuid",
      required: true,
      unique: true,
    });
    expect(ir.entities.User?.fields).toHaveProperty("createdAt");
    expect(ir.entities.User?.fields).toHaveProperty("deletedAt");
    expect(ir.dependencyEdges.map((edge) => `${edge.dependency}->${edge.dependent}`)).toEqual([
      "Order->OrderItem",
      "Order->OrderItem",
      "User->Order",
    ]);
  });

  it("produces canonical output when entity and object keys are reordered", () => {
    const first = createValidConfig();
    first.entities.User.fields.profile = { type: "json", default: { z: 1, a: [3, 2] } };
    const second = createValidConfig();
    second.entities.User.fields.profile = { type: "json", default: { a: [3, 2], z: 1 } };
    const firstRepresentation = buildIntermediateRepresentation(first);
    const secondRepresentation = buildIntermediateRepresentation(second);
    expect(serializeIntermediateRepresentation(firstRepresentation)).toBe(
      serializeIntermediateRepresentation(secondRepresentation),
    );
    expect(serializeIntermediateRepresentation(firstRepresentation).endsWith("\n")).toBe(true);
  });

  it("sorts endpoints with identical paths by HTTP method", () => {
    const config = createValidConfig();
    config.endpoints.push({
      path: (config.endpoints[0] as { path: string }).path,
      method: "POST",
      entity: "Order",
    });
    expect(
      buildIntermediateRepresentation(config).endpoints.map((endpoint) => endpoint.method),
    ).toEqual(["GET", "POST"]);
  });

  it("preserves optional metadata when configured and omits it otherwise", () => {
    const sparse = { name: "sparse", version: "1.0.0", entities: { User: {} } };
    const bareRepresentation = buildIntermediateRepresentation(sparse);
    expect(bareRepresentation).not.toHaveProperty("database");
    expect(bareRepresentation.project).not.toHaveProperty("description");
    const full = {
      ...sparse,
      description: "Full project",
      database: { engine: "postgres", provider: "local", orm: "drizzle" },
      docker: { postgres: true },
      llm: { enabled: true, endpoint: "/ai" },
      deployment: { provider: "cloudflare", ci: "github-actions" },
      entities: { User: { description: "A user" } },
    };
    const fullRepresentation = buildIntermediateRepresentation(full);
    expect(fullRepresentation.project.description).toBe("Full project");
    expect(fullRepresentation.entities.User?.description).toBe("A user");
    expect(fullRepresentation).toHaveProperty("docker");
    expect(fullRepresentation).toHaveProperty("llm");
    expect(fullRepresentation).toHaveProperty("deployment");
  });

  it("sorts independent entities deterministically and ignores many-to-many dependencies", () => {
    expect(
      sortEntitiesTopologically({
        Zebra: { fields: {}, relations: {}, timestamps: false, softDelete: false },
        Alpha: {
          fields: {},
          relations: {
            peers: {
              type: "many-to-many",
              target: "Zebra",
              onDelete: "no-action",
              required: false,
            },
          },
          timestamps: false,
          softDelete: false,
        },
      }),
    ).toEqual(["Alpha", "Zebra"]);
    expect(
      sortEntitiesTopologically({
        Root: {
          fields: {},
          relations: {
            zebra: { type: "one-to-many", target: "Zebra" },
            alpha: { type: "one-to-many", target: "Alpha" },
          },
          timestamps: false,
          softDelete: false,
        },
        Alpha: { fields: {}, relations: {}, timestamps: false, softDelete: false },
        Zebra: { fields: {}, relations: {}, timestamps: false, softDelete: false },
      } as never),
    ).toEqual(["Root", "Alpha", "Zebra"]);
  });

  it("detects unknown graph nodes, dependency cycles, and invalid configs", () => {
    const unknown = {
      First: {
        fields: {},
        relations: { next: { type: "many-to-one", target: "Missing" } },
        timestamps: false,
        softDelete: false,
      },
    } as never;
    expect(() => sortEntitiesTopologically(unknown)).toThrowError(NordixConfigError);
    const unknownDependent = {
      Parent: {
        fields: {},
        relations: { children: { type: "one-to-many", target: "Missing" } },
        timestamps: false,
        softDelete: false,
      },
    } as never;
    expect(() => sortEntitiesTopologically(unknownDependent)).toThrow(/unknown entity "Missing"/);
    const cycle = {
      First: {
        fields: {},
        relations: { second: { type: "many-to-one", target: "Second" } },
        timestamps: false,
        softDelete: false,
      },
      Second: {
        fields: {},
        relations: { first: { type: "many-to-one", target: "First" } },
        timestamps: false,
        softDelete: false,
      },
    } as never;
    expect(() => sortEntitiesTopologically(cycle)).toThrow(
      /dependency cycle detected among: First, Second/,
    );
    expect(() =>
      buildIntermediateRepresentation({ name: "invalid", version: "bad", entities: {} }),
    ).toThrowError(NordixConfigError);
  });
});
