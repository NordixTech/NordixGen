import { posix } from "node:path";
import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
export function backendEnvironmentFile(context: BackendRenderContext): GeneratedFile {
  const identity = context.identity;
  const lines = [
    ...(context.domainModel.backend.ai
      ? [
          "OPENAI_API_KEY=",
          "ANTHROPIC_API_KEY=",
          "GEMINI_API_KEY=",
          "GROQ_API_KEY=",
          "AI_MODEL=",
          ...(context.domainModel.backend.ai.mcp.enabled
            ? ["MCP_PUBLIC_URL=http://localhost:8790"]
            : []),
        ]
      : []),
    "# Local examples only. Supply real values externally; never commit runtime secrets.",
    ...(context.persistence ? ["DATABASE_URL="] : []),
    ...(identity
      ? [
          "BETTER_AUTH_SECRET=",
          "BETTER_AUTH_URL=http://localhost:3000",
          "AUTH_TRUSTED_ORIGINS=http://localhost:3000",
          "NODE_ENV=development",
          ...(identity.identityProviders.includes("microsoft")
            ? ["MICROSOFT_TENANT_ID=common"]
            : []),
          ...(identity.methods.includes("phone-number")
            ? ["TWILIO_ACCOUNT_SID=", "TWILIO_AUTH_TOKEN=", "TWILIO_FROM_NUMBER="]
            : []),
          ...identity.identityProviders.flatMap((provider) => [
            `${provider.toUpperCase()}_CLIENT_ID=`,
            `${provider.toUpperCase()}_CLIENT_SECRET=`,
          ]),
          ...(identity.methods.includes("email-password") ||
          identity.allowedEmailDomains?.length ||
          identity.features.some(
            (feature) => feature === "email-verification" || feature === "password-recovery",
          )
            ? [
                "RESEND_API_KEY=",
                "AUTH_EMAIL_FROM=",
                "SMTP_HOST=",
                "SMTP_PORT=1025",
                "SMTP_SECURE=false",
                "SMTP_USER=",
                "SMTP_PASSWORD=",
              ]
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
  return {
    path: posix.join(context.framework.applicationRoot, ".env.example"),
    content: [
      "# Server-only local backend origins. Browsers always call this frontend.",
      ...context.frontend.connections.map(
        (name) =>
          `BACKEND_${name.toUpperCase().replaceAll("-", "_")}_INTERNAL_URL=http://localhost:${8787 + context.frontend.connections.indexOf(name)}`,
      ),
      "",
    ].join("\n"),
  };
}
