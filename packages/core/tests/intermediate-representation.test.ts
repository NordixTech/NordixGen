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
    expect(ir.formatVersion).toBe(4);
    expect(ir.entityOrder).toEqual(["User", "Order", "OrderItem"]);
    expect(Object.keys(ir.entities)).toEqual(["Order", "OrderItem", "User"]);
    expect(ir.entities.User?.fields).toHaveProperty("id", {
      type: "uuid",
      required: true,
      unique: true,
    });
    expect(ir.entities.User?.fields).toHaveProperty("createdAt");
    expect(ir.entities.User?.fields).toHaveProperty("deletedAt");
    expect(ir.entities.OrderItem?.backend).toBe("core-api");
    expect(ir.entities.OrderItem?.fields).toHaveProperty("createdAt");
    expect(ir.entities.OrderItem?.fields).not.toHaveProperty("updatedAt");
    expect(ir.repositories.map((repository) => repository.name)).toEqual(["commerce"]);
    expect(ir.dependencyEdges.map((edge) => `${edge.dependency}->${edge.dependent}`)).toEqual([
      "Order->OrderItem",
      "Order->OrderItem",
      "User->Order",
    ]);
  });

  it("stores resolved pagination options in the IR and omits profiles and unpaginated values", () => {
    const config = createValidConfig();
    const { pagination: paginationProfiles, ...normalizedConfig } = config;
    const unpaginatedEndpoint = {
      ...normalizedConfig.endpoints[0],
      operationId: "getOrdersWithoutPagination",
      path: "/api/orders/unpaginated",
      pagination: undefined,
    };
    normalizedConfig.endpoints.push(unpaginatedEndpoint as (typeof config.endpoints)[number]);
    const ir = buildIntermediateRepresentation({
      ...normalizedConfig,
      pagination: paginationProfiles,
    });
    expect(
      ir.endpoints.find((endpoint) => endpoint.operationId === "getOrderSummary")?.pagination,
    ).toEqual({
      strategy: "offset",
      pageParam: "page",
      pageSizeParam: "pageSize",
      defaultPageSize: 20,
      maxPageSize: 80,
    });
    expect(
      ir.endpoints.find((endpoint) => endpoint.operationId === "getOrdersWithoutPagination"),
    ).toMatchObject({ pagination: undefined });
  });

  it("produces canonical output when entity and object keys are reordered", () => {
    const first = createValidConfig();
    const firstRepository = first.repositories[0];
    if (!firstRepository) throw new Error("Fixture is incomplete.");
    firstRepository.path = "repos/commerce";
    first.repositories.push({ name: "notifications", path: "repos/notifications" });
    first.organizations.push({ name: "team-alpha", handle: "TeamAlpha" });
    first.entities.User.fields.profile = { type: "json", default: { z: 1, a: [3, 2] } };
    const second = createValidConfig();
    const secondRepository = second.repositories[0];
    if (!secondRepository) throw new Error("Fixture is incomplete.");
    secondRepository.path = "repos/commerce";
    second.repositories.reverse();
    second.repositories.push({ name: "notifications", path: "repos/notifications" });
    second.repositories.reverse();
    second.organizations.push({ name: "team-alpha", handle: "TeamAlpha" });
    second.organizations.reverse();
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
      operationId: "queryOrders",
      backend: "core-api",
      entity: "Order",
    });
    expect(
      buildIntermediateRepresentation(config).endpoints.map((endpoint) => endpoint.method),
    ).toEqual(["GET", "POST"]);
  });

  it("preserves optional metadata when configured and omits it otherwise", () => {
    const config = createValidConfig();
    const bare = buildIntermediateRepresentation(config);
    expect(bare.project).not.toHaveProperty("description");
    const described = buildIntermediateRepresentation({ ...config, description: "Full project" });
    expect(described.project.description).toBe("Full project");
    expect(described.databases).toEqual({ "commerce-db": {} });
    expect(described).not.toHaveProperty("docker");
    expect(described).not.toHaveProperty("llm");
    expect(described).not.toHaveProperty("deployment");
  });

  it("sorts independent entities deterministically and ignores many-to-many dependencies", () => {
    expect(
      sortEntitiesTopologically({
        Zebra: {
          backend: "api",
          fields: {},
          relations: {},
          timestamps: { createdAt: false, updatedAt: false },
          softDelete: false,
        },
        Alpha: {
          fields: {},
          backend: "api",
          relations: {
            peers: {
              type: "many-to-many",
              target: "Zebra",
              onDelete: "no-action",
              required: false,
            },
          },
          timestamps: { createdAt: false, updatedAt: false },
          softDelete: false,
        },
      }),
    ).toEqual(["Alpha", "Zebra"]);
    expect(
      sortEntitiesTopologically({
        Root: {
          backend: "api",
          fields: {},
          relations: {
            zebra: { type: "one-to-many", target: "Zebra" },
            alpha: { type: "one-to-many", target: "Alpha" },
          },
          timestamps: { createdAt: false, updatedAt: false },
          softDelete: false,
        },
        Alpha: {
          backend: "api",
          fields: {},
          relations: {},
          timestamps: { createdAt: false, updatedAt: false },
          softDelete: false,
        },
        Zebra: {
          backend: "api",
          fields: {},
          relations: {},
          timestamps: { createdAt: false, updatedAt: false },
          softDelete: false,
        },
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
