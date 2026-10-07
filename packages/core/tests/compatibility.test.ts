import { describe, expect, it } from "vitest";
import { INCOMPATIBILITY_MATRIX, validateCompatibility } from "../src/compatibility.js";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { createValidConfig } from "./fixtures.js";

describe("incompatibility matrix", () => {
  it("exposes the supported compatibility rules and accepts the golden path", () => {
    expect(INCOMPATIBILITY_MATRIX.map((rule) => rule.id)).toEqual([
      "frontend-backend-link",
      "query-hook-strategy",
      "neon-postgres",
      "cloudflare-native-ci",
      "secured-endpoint-auth",
    ]);
    expect(validateCompatibility(NordixConfigSchema.parse(createValidConfig()))).toEqual([]);
  });

  it("reports frontend, query, provider, CI, and auth conflicts with stable codes", () => {
    const config = NordixConfigSchema.parse({
      ...createValidConfig(),
      frontends: [
        {
          name: "web",
          framework: "nextjs",
          path: "apps/web",
          repository: "commerce",
          connectsTo: ["missing-api"],
          stateManagement: { client: "zustand", server: "native-fetch", generateHooks: true },
        },
      ],
      backends: [
        {
          name: "api",
          framework: "hono",
          path: "apps/api",
          repository: "commerce",
          auth: { type: "none" },
        },
      ],
      databases: { "commerce-db": { engine: "mysql", provider: "neon" } },
      deployment: { provider: "aws", ci: "cloudflare-native" },
      endpoints: [
        { path: "/api/secure", method: "GET", backend: "api", entity: "User", authRequired: true },
      ],
    });
    expect(validateCompatibility(config).map((diagnostic) => diagnostic.code)).toEqual([
      "INCOMPATIBLE_FRONTEND_BACKEND",
      "INCOMPATIBLE_QUERY_HOOK_STRATEGY",
      "INCOMPATIBLE_NEON_DATABASE",
      "INCOMPATIBLE_CLOUDFLARE_CI",
      "INCOMPATIBLE_ENDPOINT_AUTH",
    ]);
  });

  it("supports legacy string state-management declarations", () => {
    const config = NordixConfigSchema.parse({
      ...createValidConfig(),
      frontends: [
        {
          name: "web",
          framework: "nextjs",
          path: "apps/web",
          repository: "commerce",
          stateManagement: "zustand",
        },
      ],
    });
    expect(validateCompatibility(config)).toEqual([]);
  });

  it("evaluates each secured-endpoint signal independently", () => {
    const config = NordixConfigSchema.parse({
      ...createValidConfig(),
      backends: [
        {
          name: "api",
          framework: "hono",
          path: "apps/api",
          repository: "commerce",
          auth: { type: "none" },
        },
      ],
      endpoints: [
        { path: "/a", method: "GET", backend: "api", entity: "User", authRequired: true },
        { path: "/b", method: "GET", backend: "api", entity: "User", roles: ["admin"] },
        { path: "/c", method: "GET", backend: "api", entity: "User", permissions: ["users:read"] },
        { path: "/d", method: "GET", backend: "api", entity: "User" },
      ],
    });
    expect(
      validateCompatibility(config).filter((item) => item.code === "INCOMPATIBLE_ENDPOINT_AUTH"),
    ).toHaveLength(3);
  });
});
