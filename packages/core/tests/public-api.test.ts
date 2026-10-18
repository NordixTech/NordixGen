import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("supported core package API", () => {
  it("resolves and generates the commerce applications without exposing renderer extension points", () => {
    const source = readFileSync(
      new URL("../../../examples/full-stack-commerce/project.yaml", import.meta.url),
      "utf8",
    );
    const result = core.resolveProjectYaml(source, "project.yaml", { requireGeneration: true });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.diagnostics.map(core.formatDiagnostic).join("\n"));
    expect(core.generationReadiness(result.project)).toEqual([]);
    const backend = core.generateBackend(result.project, "api");
    const frontend = core.generateFrontend(result.project, "web");
    expect(backend.success).toBe(true);
    expect(frontend.success).toBe(true);
    if (!backend.success || !frontend.success) throw new Error("Commerce generation failed");
    expect(backend.virtualFileSystem.listFiles()).toContain("apps/api/src/index.ts");
    expect(frontend.virtualFileSystem.listFiles()).toContain("apps/web/src/app/page.tsx");
    expect(core.getCoreInfo().version).toBe(core.CORE_VERSION);
    for (const internal of [
      "backendRenderContext",
      "buildFrontendApiContract",
      "resolveCleanArchitectureLayout",
      "generateApplicationFiles",
      "generateHonoFiles",
      "generateDrizzleFiles",
      "MODULE_GENERATION_SUPPORT",
    ])
      expect(core).not.toHaveProperty(internal);
  });
});
