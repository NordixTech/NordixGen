import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createNordixJsonSchema } from "../src/json-schema.js";

describe("IDE JSON Schema generation", () => {
  it("keeps the checked-in editor schema identical to the runtime definitions", () => {
    const checkedIn = JSON.parse(
      readFileSync(new URL("../../../nordix.schema.json", import.meta.url), "utf8"),
    );
    expect(checkedIn).toEqual(createNordixJsonSchema());
    expect(checkedIn.properties.schemaVersion.const).toBe(2);
    const backend = checkedIn.properties.backends.items;
    expect(backend.required).toContain("modules");
    expect(backend.properties).not.toHaveProperty("framework");
    expect(backend.properties).not.toHaveProperty("architecture");
    expect(checkedIn.properties.frontends.items.properties).not.toHaveProperty("stateManagement");
    expect(backend.properties.modules.additionalProperties.properties.architecture.enum).toEqual([
      "clean",
      "hexagonal",
      "onion",
    ]);
  });
  it("generates a draft 7 schema for the complete config shape", () => {
    const schema = createNordixJsonSchema();
    expect(schema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "NordixGen Configuration",
    });
    expect(schema).toHaveProperty("properties.name");
    expect(schema).toHaveProperty("properties.entities");
    expect(schema).toHaveProperty("properties.frontends");
    expect(schema).toHaveProperty("properties.databases");
    expect(schema.properties).not.toHaveProperty("database");
  });
});
