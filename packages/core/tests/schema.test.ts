import { describe, expect, it } from "vitest";
import {
  BackendSchema,
  EntitySchema,
  EndpointSchema,
  FieldSchema,
  FrontendSchema,
  NordixConfigSchema,
  RelationSchema,
  normalizeBackends,
  normalizeFrontends,
} from "../src/configuration/schema.js";
import { createValidConfig } from "./fixtures.js";

describe("Nordix configuration schemas", () => {
  it("accepts supported field types and rejects unsupported ones", () => {
    const values = [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "date" },
      { type: "uuid" },
      { type: "json" },
      { type: "enum", enumName: "Status" },
    ];
    for (const value of values) expect(FieldSchema.safeParse(value).success).toBe(true);
    expect(FieldSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });

  it("applies field, relation, entity, frontend, and backend defaults", () => {
    expect(FieldSchema.parse({ type: "string" })).toMatchObject({ required: true, unique: false });
    expect(RelationSchema.parse({ type: "many-to-one", target: "User" })).toMatchObject({
      onDelete: "no-action",
      required: false,
    });
    expect(EntitySchema.parse({ backend: "api" })).toMatchObject({
      fields: {},
      relations: {},
      timestamps: { createdAt: false, updatedAt: false },
      softDelete: false,
    });
    expect(
      FrontendSchema.parse({
        name: "web",
        framework: "nextjs",
        path: "apps/web",
        repository: "app",
      }),
    ).toMatchObject({ type: "web", authUI: false });
    expect(
      BackendSchema.parse({ name: "api", framework: "hono", path: "apps/api", repository: "app" }),
    ).toMatchObject({ architecture: "clean", auth: { type: "none" } });
  });

  it("rejects malformed names, paths, relations, and unknown properties", () => {
    expect(
      FrontendSchema.safeParse({
        name: "Bad Name",
        framework: "nextjs",
        path: "apps/web",
        repository: "app",
      }).success,
    ).toBe(false);
    expect(
      FrontendSchema.safeParse({
        name: "web",
        framework: "nextjs",
        path: "apps\\web",
        repository: "app",
      }).success,
    ).toBe(false);
    expect(RelationSchema.safeParse({ type: "owns", target: "User" }).success).toBe(false);
    expect(EntitySchema.safeParse({ unexpected: true }).success).toBe(false);
  });

  it("accepts the full configuration shape and rejects invalid required values", () => {
    expect(NordixConfigSchema.safeParse(createValidConfig()).success).toBe(true);
    expect(
      NordixConfigSchema.safeParse({
        name: "sample",
        version: "1.0.0",
        repositories: [{ name: "repo", path: "." }],
        entities: {},
      }).success,
    ).toBe(false);
    expect(
      NordixConfigSchema.safeParse({ name: "sample", version: "latest", entities: { User: {} } })
        .success,
    ).toBe(false);
    expect(NordixConfigSchema.safeParse({ ...createValidConfig(), unexpected: true }).success).toBe(
      false,
    );
    expect(
      NordixConfigSchema.safeParse({
        ...createValidConfig(),
        database: { engine: "postgres", provider: "local", orm: "drizzle" },
      }).success,
    ).toBe(false);
  });

  it("normalizes singular and plural application forms into stable name order", () => {
    const pluralConfig = NordixConfigSchema.parse({
      ...createValidConfig(),
      frontends: [
        { name: "z-web", framework: "nextjs", path: "apps/z", repository: "commerce" },
        { name: "a-web", framework: "nextjs", path: "apps/a", repository: "commerce" },
      ],
    });
    expect(normalizeFrontends(pluralConfig).map((app) => app.name)).toEqual(["a-web", "z-web"]);
    const singularConfig = NordixConfigSchema.parse({
      name: "singular",
      version: "1.0.0",
      repositories: [{ name: "app", path: "." }],
      entities: { User: { backend: "backend" } },
      frontend: { framework: "nextjs", path: "apps/web", repository: "app" },
      backend: { framework: "hono", path: "apps/api", repository: "app" },
    });
    expect(normalizeFrontends(singularConfig)[0]).toMatchObject({ name: "frontend", type: "web" });
    expect(normalizeBackends(singularConfig)[0]).toMatchObject({
      name: "backend",
      architecture: "clean",
      auth: { type: "none" },
    });
    expect(
      normalizeBackends(NordixConfigSchema.parse(createValidConfig())).map((app) => app.name),
    ).toEqual(["core-api"]);
  });

  it("fills normalization fallbacks when called with pre-schema legacy objects", () => {
    const legacy = {
      ...NordixConfigSchema.parse(createValidConfig()),
      frontend: { framework: "nextjs", path: "apps/legacy-web" },
      backend: { framework: "hono", path: "apps/legacy-api" },
    } as unknown as ReturnType<typeof NordixConfigSchema.parse>;
    expect(normalizeFrontends(legacy)[0]).toMatchObject({ type: "web", authUI: false });
    expect(normalizeBackends(legacy)[0]).toMatchObject({
      architecture: "clean",
      auth: { type: "none" },
    });
  });
  it("validates endpoint path templates and opt-in pagination bounds", () => {
    const endpoint = {
      backend: "api",
      path: "/orders/{orderId}",
      method: "GET",
      entity: "Order",
    };
    expect(
      EndpointSchema.safeParse({
        ...endpoint,
        pathParams: [{ name: "orderId", type: "uuid" }],
      }).success,
    ).toBe(true);
    expect(EndpointSchema.safeParse({ ...endpoint }).success).toBe(false);
    expect(
      EndpointSchema.safeParse({
        ...endpoint,
        path: "/orders",
        pathParams: [{ name: "orderId", type: "uuid" }],
      }).success,
    ).toBe(false);
    expect(
      EndpointSchema.safeParse({
        ...endpoint,
        path: "/orders/{orderId}/{orderId}",
        pathParams: [{ name: "orderId", type: "uuid" }],
      }).success,
    ).toBe(false);
    expect(
      EndpointSchema.safeParse({
        ...endpoint,
        pathParams: [{ name: "orderId", type: "uuid" }],
        pagination: {
          pageParam: "page",
          pageSizeParam: "page",
          defaultPageSize: 20,
          maxPageSize: 10,
        },
      }).success,
    ).toBe(false);
  });
});
