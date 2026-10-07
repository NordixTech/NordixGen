import { describe, expect, it } from "vitest";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { createValidConfig } from "./fixtures.js";

describe("backend persistence configuration", () => {
  it("allows backends without persistence and multiple databases with separate ORMs", () => {
    const input = createValidConfig();
    input.databases["analytics-db"] = { engine: "postgres", provider: "local" };
    input.backends.push({
      name: "analytics-api",
      framework: "hono",
      repository: "commerce",
      path: "apps/analytics-api",
      persistence: { database: "analytics-db", orm: "prisma" },
    });
    input.backends.push({
      name: "stateless-api",
      framework: "hono",
      repository: "commerce",
      path: "apps/stateless-api",
    });

    expect(validateNordixConfig(input)).toMatchObject({ success: true });
  });

  it("reports a missing database reference at the backend's persistence path", () => {
    const input = createValidConfig();
    const backend = input.backends[0];
    if (!backend) throw new Error("Fixture is incomplete.");
    backend.persistence = { database: "missing-db", orm: "drizzle" };

    const result = validateNordixConfig(input);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid database reference.");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_BACKEND_DATABASE",
        path: "backends.core-api.persistence.database",
      }),
    );
  });

  it("rejects malformed ORM plugin identifiers", () => {
    const input = createValidConfig();
    const backend = input.backends[0];
    if (!backend) throw new Error("Fixture is incomplete.");
    backend.persistence = { database: "commerce-db", orm: "Drizzle ORM" };

    expect(validateNordixConfig(input)).toMatchObject({ success: false });
  });

  it("rejects the retired singleton database format", () => {
    const input = { ...createValidConfig(), database: { engine: "postgres", provider: "neon", orm: "drizzle" } };
    expect(validateNordixConfig(input)).toMatchObject({ success: false });
  });
});
