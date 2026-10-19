import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { parseNordixYaml, validateNordixConfig } from "../src/configuration/validate.js";
import { resolveProject, resolveProjectYaml } from "../src/project/resolve.js";
import { targetConfig } from "./fixtures.js";

function multipleBackends(database = "primary") {
  const config = targetConfig("single-module");
  config.entities.Metric = { ...config.entities.Note, backend: "analytics" };
  config.backends.push({
    ...config.backends[0],
    name: "analytics",
    path: "apps/analytics",
    persistence: { database },
    modules: { metrics: { architecture: "clean", entities: ["Metric"], exports: [], imports: {} } },
  });
  return config;
}

describe("exclusive database ownership", () => {
  it("rejects every colliding reference with all owners and corrective actions", () => {
    const config = multipleBackends();
    config.entities.Report = { ...config.entities.Note, backend: "reporting" };
    config.backends.push({
      ...config.backends[1],
      name: "reporting",
      path: "apps/reporting",
      modules: {
        reports: { architecture: "clean", entities: ["Report"], exports: [], imports: {} },
      },
    });
    const result = validateNordixConfig(config);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toHaveLength(3);
    for (const [index, diagnostic] of result.diagnostics.entries()) {
      expect(diagnostic).toMatchObject({
        code: "DATABASE_SHARED_ACROSS_BACKENDS",
        severity: "error",
        path: `backends[${index}].persistence.database`,
      });
      for (const name of ["primary", "api", "analytics", "reporting"])
        expect(diagnostic.message).toContain(`"${name}"`);
      expect(diagnostic.message).toContain("single modular monolith");
      expect(diagnostic.message).toContain("distinct resource under databases");
    }
  });

  it("rejects sharing across separate repositories as well", () => {
    const config = multipleBackends();
    config.repositories[0].path = "main";
    config.repositories.push({ ...config.repositories[0], name: "other", path: "other" });
    config.backends[1].repository = "other";
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: [
        { code: "DATABASE_SHARED_ACROSS_BACKENDS" },
        { code: "DATABASE_SHARED_ACROSS_BACKENDS" },
      ],
    });
  });

  it("accepts distinct resources and records their exclusive owners", () => {
    const config = multipleBackends("analytics-db");
    config.databases["analytics-db"] = {};
    expect(validateNordixConfig(config)).toMatchObject({ success: true, diagnostics: [] });
    const result = resolveProject(config, { requireGeneration: true });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected distinct resources to resolve");
    expect(result.project.databases.primary.backend).toBe("api");
    expect(result.project.databases["analytics-db"].backend).toBe("analytics");
    for (const backend of Object.values(result.project.backends))
      expect(backend.database).toBe(result.project.databases[backend.database?.name ?? ""]);
  });

  it("keeps single-backend configurations ready and marks unused resources by absent ownership", () => {
    const config = targetConfig("single-module");
    config.databases.unused = {};
    const result = resolveProject(config, { requireGeneration: true });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected single backend to resolve");
    expect(result.diagnostics).toEqual([]);
    expect(result.project.databases.primary.backend).toBe("api");
    expect(result.project.databases.unused).not.toHaveProperty("backend");
  });

  it("allows backends without persistence and preserves unknown-reference diagnostics", () => {
    const config = multipleBackends();
    config.backends[1].persistence = undefined;
    expect(validateNordixConfig(config)).toMatchObject({ success: true, diagnostics: [] });
    for (const backend of config.backends) backend.persistence = { database: "missing" };
    const result = validateNordixConfig(config);
    expect(result.success).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "UNKNOWN_BACKEND_DATABASE",
      "UNKNOWN_BACKEND_DATABASE",
    ]);
  });

  it.each([false, true])(
    "blocks project resolution with requireGeneration=%s",
    (requireGeneration) => {
      const config = multipleBackends();
      const source = stringify(config);
      const parsed = parseNordixYaml(source, "shared.yaml");
      expect(parsed.success).toBe(false);
      for (const diagnostic of parsed.diagnostics) {
        expect(diagnostic.source?.file).toBe("shared.yaml");
        expect(source.split("\n")[(diagnostic.source?.line ?? 0) - 1].trim()).toBe(
          "database: primary",
        );
      }
      expect(resolveProject(config, { requireGeneration }).success).toBe(false);
      expect(resolveProjectYaml(source, "shared.yaml", { requireGeneration })).toEqual(parsed);
    },
  );
});
