import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { createValidConfig } from "./fixtures.js";

describe("canonical fixed-stack configuration structure", () => {
  it("requires schema version, explicit modules and operation identities", () => {
    const config = createValidConfig();
    expect(NordixConfigSchema.safeParse(config).success).toBe(true);
    for (const field of ["schemaVersion", "backends", "entities"]) {
      const invalid = { ...config } as Record<string, unknown>;
      delete invalid[field];
      expect(validateNordixConfig(invalid).success, field).toBe(false);
    }
    const missingOperation = structuredClone(config);
    (missingOperation.endpoints[0] as Record<string, unknown>).operationId = undefined;
    expect(validateNordixConfig(missingOperation).diagnostics).toContainEqual(
      expect.objectContaining({ code: "CONFIG_FIELD_REQUIRED", path: "endpoints[0].operationId" }),
    );
  });

  it("applies project defaults without reintroducing technology selectors", () => {
    const config = NordixConfigSchema.parse(createValidConfig());
    expect(config.frontends[0]?.access).toEqual({ mode: "public" });
    expect(config.backends[0]?.modules.commerce).toMatchObject({
      architecture: "clean",
      exports: [],
      imports: {},
    });
    expect(config.backends[0]).not.toHaveProperty("framework");
    expect(config.backends[0]?.persistence).toEqual({ database: "commerce-db" });
    expect(config.databases["commerce-db"]).toEqual({});
  });

  it.each([
    ["framework", "hono"],
    ["architecture", "clean"],
    ["auth", { type: "jwt" }],
  ])("rejects retired backend selector %s with a correction", (key, value) => {
    const config = createValidConfig();
    Object.assign(config.backends[0] ?? {}, { [key]: value });
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CONFIG_FIELD_REMOVED",
        path: `backends[0].${key}`,
        message: expect.stringMatching(/Remove|remove/),
      }),
    );
  });

  it.each(["framework", "type", "styling", "ui", "stateManagement", "authUI"])(
    "rejects retired frontend option %s",
    (key) => {
      const config = createValidConfig();
      Object.assign(config.frontends[0] ?? {}, { [key]: "obsolete" });
      expect(validateNordixConfig(config).diagnostics).toContainEqual(
        expect.objectContaining({ code: "CONFIG_FIELD_REMOVED", path: `frontends[0].${key}` }),
      );
    },
  );

  it.each(["frontend", "backend", "deployment", "docker", "llm"])(
    "rejects removed root field %s",
    (key) => {
      expect(
        validateNordixConfig({ ...createValidConfig(), [key]: {} }).diagnostics,
      ).toContainEqual(expect.objectContaining({ code: "CONFIG_FIELD_REMOVED", path: key }));
    },
  );

  it("reports unknown, missing and mistyped fields without semantic cascades", () => {
    const config = createValidConfig();
    Object.assign(config.backends[0] ?? {}, { modules: "broken", mystery: "private-token" });
    const result = validateNordixConfig(config);
    expect(result.success).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(["CONFIG_FIELD_TYPE_INVALID", "CONFIG_FIELD_UNKNOWN"]),
    );
    expect(result.diagnostics.some((d) => /OWNER|IMPORT/.test(d.code))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
});
