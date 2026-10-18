import { describe, expect, it } from "vitest";
import { backendRenderContext, generateBackend } from "../src/generation/backend.js";
import { backendDependencies } from "../src/generation/dependencies.js";
import { BACKEND_SCAFFOLD_OVERLAYS, collectFiles } from "../src/generation/files.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { generateBetterAuthFiles } from "../src/plugins/authentication/better-auth.js";
import { generateAuthorizationFiles } from "../src/plugins/authorization/roles-permissions.js";
import { generateDrizzleFiles } from "../src/plugins/orms/drizzle.js";
import { createSecuredConfig, createValidConfig, resolvedFixture } from "./fixtures.js";

describe("direct backend generation and file ownership", () => {
  it("collects distinct complete paths deterministically and rejects duplicate owners even for equal content", () => {
    const files = [
      {
        owner: "customers",
        files: [{ path: "apps/api/src/modules/customers/index.ts", content: "a" }],
      },
      {
        owner: "billing",
        files: [{ path: "apps/api/src/modules/billing/index.ts", content: "b" }],
      },
    ];
    expect(collectFiles("apps/api", files).listFiles()).toEqual([
      "apps/api/src/modules/billing/index.ts",
      "apps/api/src/modules/customers/index.ts",
    ]);
    for (const duplicate of [
      "apps/api/src/modules/customers/index.ts",
      "apps/api/./src/modules/customers/INDEX.ts",
    ])
      expect(() =>
        collectFiles("apps/api", [
          ...files,
          { owner: "duplicate", files: [{ path: duplicate, content: "a" }] },
        ]),
      ).toThrow(/GENERATED_FILE_OWNER_CONFLICT.*customers.*duplicate/);
    expect(
      collectFiles(".", [
        { owner: "root", files: [{ path: "src/index.ts", content: "root" }] },
      ]).listFiles(),
    ).toEqual(["src/index.ts"]);
    expect(BACKEND_SCAFFOLD_OVERLAYS).toEqual(["src/index.ts", "wrangler.jsonc"]);
  });
  it.each([
    "../secret",
    "/absolute/file",
    "C:/outside",
    "apps/other/file",
    "apps/api/../escape",
    "apps/api\\escape",
    "apps/api/\0bad",
  ])("rejects unsafe file %s before emission", (path) => {
    expect(() =>
      collectFiles("apps/api", [{ owner: "broken", files: [{ path, content: "bad" }] }]),
    ).toThrow();
  });
  it("assembles all schemas once, exposes only declarations and centralizes runtime and tooling", () => {
    const project = resolvedFixture(createSecuredConfig());
    const result = generateBackend(project, "core-api");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const files = result.virtualFileSystem.snapshot();
    const index = files["apps/api-core/src/platform/database/schema/index.ts"];
    for (const name of ["Customer", "Order", "OrderItem"])
      expect(
        Object.values(files).join("\n").split(`export const ${name}Table = pgTable`).length - 1,
      ).toBe(1);
    expect(index).toContain("auth-schema.js");
    expect(
      Object.keys(files).filter(
        (path) => path.endsWith("/index.ts") && path.includes("/platform/database/schema"),
      ),
    ).toHaveLength(1);
    expect(result.runtimeDependencies).toHaveProperty("better-auth");
    expect(result.runtimeDependencies).not.toHaveProperty("drizzle-kit");
    expect(result.developmentDependencies).toHaveProperty("drizzle-kit");
    expect(generateBackend(project, "core-api")).toEqual(result);
    const dependencies = backendDependencies(false, false);
    expect(dependencies.runtimeDependencies).not.toHaveProperty("drizzle-orm");
  });
  it("retains frontend assembly while removing the backend registry", () => {
    const project = resolvedFixture(createValidConfig());
    const result = generateFrontend(
      project,
      project.frontends[Object.keys(project.frontends)[0]].name,
    );
    expect(result.success).toBe(true);
  });
  it("requires resolved identity and persistence at direct feature boundaries", () => {
    const context = backendRenderContext(resolvedFixture(), "core-api");
    expect(() => generateBetterAuthFiles(context)).toThrow(/identity/);
    expect(() => generateAuthorizationFiles(context)).toThrow(/identity/);
    expect(() => generateDrizzleFiles({ ...context, persistence: undefined })).toThrow(/database/);
    const authenticated = backendRenderContext(resolvedFixture(createSecuredConfig()), "core-api");
    expect(() => generateBetterAuthFiles({ ...authenticated, persistence: undefined })).toThrow(
      /persistence/,
    );
  });
});
