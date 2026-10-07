import { describe, expect, it } from "vitest";
import { createNordixJsonSchema } from "../src/json-schema.js";

describe("IDE JSON Schema generation", () => {
  it("generates a draft 7 schema for the complete config shape", () => {
    const schema = createNordixJsonSchema();
    expect(schema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "NordixGen Configuration",
    });
    expect(schema).toHaveProperty("properties.name");
    expect(schema).toHaveProperty("properties.entities");
    expect(schema).toHaveProperty("properties.frontends");
  });
});
