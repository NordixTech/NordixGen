import { parseNordixYaml, resolveProjectYaml, stringifyNordixYaml } from "@nordixgen/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { dockerFiles } from "./docker.js";
import { createStarterConfiguration } from "./orchestrator.js";

function project(split = false, root = false) {
  const parsed = parseNordixYaml(createStarterConfiguration("docker-example", true));
  if (!parsed.success) throw Error("Invalid starter");
  const config = parsed.config;
  config.backends[0].authentication = {
    methods: ["email-password"],
    identityProviders: [],
    features: [],
  };
  if (split) {
    config.repositories[0].path = "backend";
    config.repositories.push({ ...config.repositories[0], name: "web", path: "web" });
    config.frontends[0].repository = "web";
  }
  if (root) config.backends[0].path = ".";
  const result = resolveProjectYaml(stringifyNordixYaml(config), undefined, {
    requireGeneration: true,
  });
  if (!result.success) throw Error(JSON.stringify(result.diagnostics));
  return result.project;
}
describe("local Docker topology", () => {
  it("emits independently built applications, isolated persistence and browser-safe URLs", () => {
    const resolved = project();
    const files = dockerFiles(resolved, resolved.repositories[0]);
    const compose = parse(files["docker-compose.yml"]);
    expect(compose.services["postgres-api"].image).toBe("postgres:16-alpine");
    expect(compose.services["backend-api"].depends_on["postgres-api"].condition).toBe(
      "service_healthy",
    );
    expect(compose.services["backend-api"].environment.NEON_HTTP_PROXY_URL).toBe(
      "http://neon-api:4444/sql",
    );
    expect(compose.services["frontend-web"].environment.BACKEND_API_INTERNAL_URL).toContain(
      "http://backend-api:",
    );
    expect(compose.services["frontend-web"].environment.BACKEND_API_INTERNAL_URL).toContain(
      "http://backend-api:8787",
    );
    expect(compose.services["frontend-web"].depends_on["backend-api"].condition).toBe(
      "service_healthy",
    );
    expect(files["apps/web/Dockerfile"]).not.toContain("NEXT_PUBLIC_AUTH_BASE_URL");
    expect(files["apps/web/Dockerfile"]).toContain('"apps/web/server.js"');
    expect(files["apps/web/next.config.ts"]).toContain('output:"standalone"');
    expect(files["apps/api/Dockerfile"]).toContain("test -f drizzle/meta/_journal.json");
    expect(files["apps/api/Dockerfile"]).not.toContain("pnpm db:generate");
    expect(files["apps/api/Dockerfile"]).toContain("--legacy --prod /out");
    expect(files[".dockerignore"]).toContain("**/.dev.vars");
  });
  it("connects split repositories over the shared private bridge", () => {
    const resolved = project(true);
    const backend = parse(dockerFiles(resolved, resolved.repositories[0])["docker-compose.yml"]);
    const frontend = parse(dockerFiles(resolved, resolved.repositories[1])["docker-compose.yml"]);
    expect(Object.keys(backend.services)).toEqual(["postgres-api", "neon-api", "backend-api"]);
    expect(Object.keys(frontend.services)).toEqual(["frontend-web"]);
    expect(frontend.services["frontend-web"].depends_on).toBeUndefined();
    expect(frontend.services["frontend-web"].environment.BACKEND_API_INTERNAL_URL).toContain(
      "http://backend-api:",
    );
    expect(frontend.services["frontend-web"].extra_hosts).toBeUndefined();
    expect(frontend.volumes).toBeUndefined();
    expect(frontend.name).not.toBe(backend.name);
  });
  it("handles application paths at the root and assigns project-wide non-colliding ports", () => {
    const resolved = project(true, true);
    const files = dockerFiles(resolved, resolved.repositories[0]);
    expect(files.Dockerfile).toContain("WORKDIR /workspace");
    expect(parse(files["docker-compose.yml"]).services["backend-api"].build.dockerfile).toBe(
      "Dockerfile",
    );
    const second = {
      ...resolved.backends.api,
      name: "reports",
      database: { name: "reports-db", engine: "postgres" as const, provider: "neon" as const },
    };
    const expanded = { ...resolved, backends: { ...resolved.backends, reports: second } };
    const compose = parse(dockerFiles(expanded, resolved.repositories[0])["docker-compose.yml"]);
    expect(compose.services["backend-reports"].ports).toBeUndefined();
    expect(compose.services["backend-reports"].expose).toEqual(["8787"]);
    expect(compose.services["postgres-reports"].ports[0]).toContain(":-5433}");
    expect(compose.volumes.postgres_data_primary).toBeDefined();
    expect(compose.volumes["postgres_data_reports-db"]).toBeDefined();
  });
});
