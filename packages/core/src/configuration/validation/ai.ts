import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";

export function validateAi(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const add = (code: string, path: string, message: string) =>
    diagnostics.push(createDiagnostic(code, path, message));
  const enabled = config.backends.filter((backend) => backend.ai?.enabled);
  for (const [index, backend] of config.backends.entries()) {
    if (!backend.ai?.enabled) continue;
    const path = `backends[${index}].ai`;
    if (enabled.length > 1)
      add("AI_BACKEND_MULTIPLE", path, "Enable AI on only one backend per project.");
    if (!backend.authentication || !backend.persistence)
      add(
        "AI_IDENTITY_REQUIRED",
        path,
        "AI requires authentication and database persistence on this backend.",
      );
    const gatewayPath = `${backend.path}/mcp-gateway`;
    if (
      backend.ai.mcp.enabled &&
      [...config.backends, ...config.frontends].some(
        (app) =>
          app.repository === backend.repository &&
          (app.path === gatewayPath || app.path.startsWith(`${gatewayPath}/`)),
      )
    )
      add(
        "AI_GATEWAY_PATH_COLLISION",
        path,
        "Reserve the backend mcp-gateway directory for the generated public MCP Worker.",
      );
    for (const [ei, endpoint] of config.endpoints.entries()) {
      if (endpoint.backend !== backend.name) continue;
      if (
        endpoint.path === "/mcp" ||
        endpoint.path.startsWith("/mcp/") ||
        endpoint.path === "/api/chat" ||
        endpoint.path.startsWith("/api/ai/") ||
        endpoint.path.startsWith("/.well-known/") ||
        ["/authorize", "/token", "/sign-in", "/consent"].includes(endpoint.path)
      )
        add(
          "AI_ROUTE_COLLISION",
          `endpoints[${ei}].path`,
          "This route is reserved for the AI platform. Choose a different business route.",
        );
      if (
        Object.hasOwn(endpoint.requestBody ?? {}, "confirm") ||
        (endpoint.requestBody &&
          "useCase" in endpoint.requestBody &&
          Object.hasOwn(config.entities[endpoint.entity]?.fields ?? {}, "confirm")) ||
        [...endpoint.queryParams, ...endpoint.pathParams].some(
          (parameter) => parameter.name === "confirm",
        )
      )
        add(
          "AI_INPUT_COLLISION",
          `endpoints[${ei}]`,
          "The AI confirmation parameter 'confirm' is reserved. Rename this business input.",
        );
      const module = Object.entries(backend.modules).find(([, module]) =>
        module.entities.includes(endpoint.entity),
      )?.[0];
      if (module && `${module.replaceAll("-", "_")}_${endpoint.operationId}`.length > 64)
        add(
          "AI_TOOL_NAME_INVALID",
          `endpoints[${ei}].operationId`,
          "Shorten the module or operation name so the generated tool name fits 64 characters.",
        );
    }
  }
  for (const [index, frontend] of config.frontends.entries()) {
    if (!frontend.ai?.enabled) continue;
    const path = `frontends[${index}].ai`;
    const backend = config.backends.find((backend) => backend.name === frontend.ai?.backend);
    if (!backend?.ai?.enabled)
      add("AI_BACKEND_NOT_ENABLED", `${path}.backend`, "Select a backend with ai.enabled: true.");
    if (!frontend.connectsTo.includes(frontend.ai.backend))
      add("AI_BACKEND_NOT_CONNECTED", `${path}.backend`, "Include the AI backend in connectsTo.");
    const authorities = frontend.connectsTo.filter(
      (name) => config.backends.find((backend) => backend.name === name)?.authentication,
    );
    if (
      (frontend.access.backend ?? (authorities.length === 1 ? authorities[0] : undefined)) !==
      frontend.ai.backend
    )
      add(
        "AI_IDENTITY_MISMATCH",
        `${path}.backend`,
        "Use the AI backend as this frontend's session authority via access.backend.",
      );
    if (frontend.ai.connectPortal.enabled && !backend?.ai?.mcp.enabled)
      add(
        "AI_MCP_NOT_ENABLED",
        `${path}.connectPortal`,
        "Enable MCP on the selected backend before enabling its connection portal.",
      );
  }
  return diagnostics;
}
