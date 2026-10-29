import { parseNordixYaml, resolveProject } from "@nordix-tech/nordixgen-core";
import { describe, expect, it } from "vitest";
import { deploymentManifest } from "./deployment.js";
import { dockerFiles } from "./docker.js";
import { prepareApplications } from "./execution.js";
import { createStarterConfiguration } from "./orchestrator.js";
import { applicationManifest } from "./workspace.js";

describe("AI application assembly and deployment", () => {
  it.each([true, false])(
    "includes an independently deployed MCP gateway (frontend=%s)",
    (frontend) => {
      const parsed = parseNordixYaml(createStarterConfiguration("ai-demo", frontend));
      if (!parsed.success) throw Error("Fixture invalid");
      const config = parsed.config;
      Object.assign(config.backends[0], {
        authentication: {},
        ai: { enabled: true, mcp: { enabled: true } },
      });
      if (frontend)
        Object.assign(config.frontends[0], {
          ai: {
            enabled: true,
            backend: "api",
            chat: { enabled: true },
            connectPortal: { enabled: true },
          },
        });
      const resolved = resolveProject(config);
      if (!resolved.success) throw Error(JSON.stringify(resolved.diagnostics));
      const project = resolved.project;
      const apps = prepareApplications(project);
      const api = apps.find((app) => app.name === "api");
      if (!api) throw Error("Missing backend");
      const backend = applicationManifest({ scripts: {} }, api, "1.0.0");
      expect(backend.scripts?.pretypecheck).toBe("node scripts/discover-tools.mjs");
      if (frontend) {
        const web = apps.find((app) => app.name === "web");
        if (!web) throw Error("Missing frontend");
        expect(
          applicationManifest({ scripts: {} }, web, "1.0.0").scripts?.pretypecheck,
        ).toBeUndefined();
      }
      const manifest = deploymentManifest(project, project.repositories[0]);
      expect(manifest.applications.find((app) => app.kind === "gateway")).toMatchObject({
        name: "api-mcp",
        path: "apps/api/mcp-gateway",
        database: false,
        connections: ["api"],
      });
      expect(manifest.applications.find((app) => app.name === "api")?.mcpGateway).toBe("api-mcp");
      expect(manifest.publicFrontends?.["api-mcp"].worker).toBe("ai-demo-api-mcp");
      const docker = dockerFiles(project, project.repositories[0]);
      expect(docker["apps/api/mcp-gateway/Dockerfile"]).toContain(
        'CMD ["node","local-server.mjs"]',
      );
      expect(docker["docker-compose.yml"]).toContain("mcp-api:");
      expect(docker["docker-compose.yml"]).toContain("MCP_PUBLIC_URL:");
    },
  );
});
