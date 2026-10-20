import { describe, expect, it } from "vitest";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { createValidConfig, resolvedFixture } from "./fixtures.js";

describe("generated local runtime examples", () => {
  it("emits public CORS/database setup and application-root PostCSS without secrets", () => {
    const project = resolvedFixture();
    const backend = generateBackend(project, "core-api").virtualFileSystem.snapshot();
    expect(backend["apps/api-core/.dev.vars.example"]).toContain(
      "DATABASE_URL=\nCORS_ALLOWED_ORIGINS=http://localhost:3000",
    );
    expect(backend["apps/api-core/.dev.vars.example"]).not.toContain("BETTER_AUTH_SECRET");
    const frontend = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
    expect(frontend["apps/store-web/.env.example"]).toContain(
      "BACKEND_CORE_API_INTERNAL_URL=http://localhost:8787",
    );
    expect(frontend["apps/store-web/.env.example"]).not.toContain("AUTH_BASE");
    expect(frontend["apps/store-web/postcss.config.mjs"]).toContain('"@tailwindcss/postcss"');
    expect(frontend["apps/store-web/src/postcss.config.mjs"]).toBeUndefined();
  });
  it("lists only required identity/provider/email settings with blank credentials", () => {
    const config = createValidConfig();
    Object.assign(config.backends[0], {
      authentication: {
        identityProviders: ["google", "github"],
        features: ["password-recovery", "email-verification"],
      },
    });
    const project = resolvedFixture(config);
    const environment = generateBackend(project, "core-api").virtualFileSystem.snapshot()[
      "apps/api-core/.dev.vars.example"
    ];
    for (const name of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "RESEND_API_KEY",
      "AUTH_EMAIL_FROM",
    ])
      expect(environment.split("\n")).toContain(`${name}=`);
    expect(environment).not.toContain("CORS_ALLOWED_ORIGINS");
    const frontend = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
    expect(frontend["apps/store-web/.env.example"]).toContain(
      "BACKEND_CORE_API_INTERNAL_URL=http://localhost:8787",
    );
    expect(frontend["apps/store-web/src/lib/auth/client.ts"]).toBeDefined();
  });
});
