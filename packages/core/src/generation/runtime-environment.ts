import { posix } from "node:path";
import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
import { backendBaseEnvironment } from "./frontend-access.js";
export function backendEnvironmentFile(context: BackendRenderContext): GeneratedFile {
  const identity = context.identity;
  const lines = [
    "# Local examples only. Supply real values externally; never commit runtime secrets.",
    ...(context.persistence ? ["DATABASE_URL="] : []),
    ...(identity
      ? [
          "BETTER_AUTH_SECRET=",
          "BETTER_AUTH_URL=http://localhost:8787",
          "AUTH_TRUSTED_ORIGINS=http://localhost:3000",
          ...identity.identityProviders.flatMap((provider) => [
            `${provider.toUpperCase()}_CLIENT_ID=`,
            `${provider.toUpperCase()}_CLIENT_SECRET=`,
          ]),
          ...(identity.features.some(
            (feature) => feature === "email-verification" || feature === "password-recovery",
          )
            ? ["RESEND_API_KEY=", "AUTH_EMAIL_FROM="]
            : []),
        ]
      : ["CORS_ALLOWED_ORIGINS=http://localhost:3000"]),
    "",
  ];
  return {
    path: posix.join(context.framework.applicationRoot, ".dev.vars.example"),
    content: lines.join("\n"),
  };
}
export function frontendEnvironmentFile(context: FrontendRenderContext): GeneratedFile {
  const local = context.frontend.connections.length === 1 ? "http://localhost:8787" : "";
  return {
    path: posix.join(context.framework.applicationRoot, ".env.example"),
    content: [
      "# Public backend origins. Configure each connected backend explicitly.",
      ...context.frontend.connections.map((name) => `${backendBaseEnvironment(name)}=${local}`),
      ...(context.frontend.identity ? [`NEXT_PUBLIC_AUTH_BASE_URL=${local}`] : []),
      "",
    ].join("\n"),
  };
}
