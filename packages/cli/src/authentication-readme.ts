import type { ResolvedProject } from "@nordix-tech/nordixgen-core";

export function authenticationReadme(
  project: ResolvedProject,
  repository: ResolvedProject["repositories"][number],
): string[] {
  const backends = Object.values(project.backends).filter(
    (app) => app.repository.name === repository.name && app.identity,
  );
  if (!backends.length) return [];
  return [
    "## Configure authentication providers",
    "",
    "Create the credentials in each provider's console first. The YAML selects features; it never contains real credentials. From this repository root, run `pnpm cicd:setup`: the assistant asks for the generated providers and email delivery settings, then uploads them to the backend's Cloudflare runtime secrets separately for staging and production. Later deployments preserve those secrets.",
    "",
    ...backends.flatMap((app) => {
      const identity = app.identity;
      if (!identity) return [];
      const sms = identity.methods.includes("phone-number");
      const email =
        identity.methods.includes("email-password") ||
        Boolean(identity.allowedEmailDomains?.length) ||
        identity.features.some((f) => f === "email-verification" || f === "password-recovery");
      if (!sms && !email && !identity.identityProviders.length) return [];
      return [
        `### ${app.name}`,
        "",
        ...(sms
          ? [
              "- **SMS OTP (Twilio):** obtain `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`, and configure `TWILIO_FROM_NUMBER` as a Twilio sender capable of sending SMS, in international format (for example `+15551234567`). Your personal signup phone is not automatically the sender. Trial accounts may require verified recipient numbers.",
            ]
          : []),
        ...(email
          ? [
              "- **Email (SMTP or Resend):** choose one delivery provider in the setup assistant. For SMTP, supply `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `AUTH_EMAIL_FROM`; use port `465` with `SMTP_SECURE=true`, or `587` with `SMTP_SECURE=false` and STARTTLS. Alternatively supply `RESEND_API_KEY` and an authorized `AUTH_EMAIL_FROM`. Leave `SMTP_HOST` unset when using the Resend API. Configure the sender/domain in your provider before testing delivery.",
            ]
          : []),
        ...identity.identityProviders.map(
          (provider) =>
            `- **OAuth (${provider}):** register a web application with the provider. Set its callback to \`https://YOUR_FRONTEND_HOST/api/auth/callback/${provider}\` (local example: \`http://localhost:3000/api/auth/callback/${provider}\`). Supply \`${provider.toUpperCase()}_CLIENT_ID\` and \`${provider.toUpperCase()}_CLIENT_SECRET\` as individual values, not the complete downloaded JSON. Use credentials/callbacks for the selected environment; Google apps in Testing also need authorized test users.${provider === "microsoft" ? " Set `MICROSOFT_TENANT_ID` if needed (default `common`)." : ""}`,
        ),
        "",
        "To add or rotate a production credential manually, run this from the repository root, replacing `SECRET_NAME` with a variable listed above. Wrangler prompts for the value without putting it in the command:",
        "",
        "```sh",
        `pnpm --dir ${JSON.stringify(app.path)} exec wrangler secret put SECRET_NAME --env production`,
        "```",
        "",
        "Repeat for each required variable; use `--env staging` for staging. The Worker must already exist and Wrangler must be authenticated to its Cloudflare account. Secret updates apply to the existing Worker; when enabling a new provider, deploy the regenerated backend and frontend too.",
        "",
      ];
    }),
    "For local `pnpm dev`, copy the backend's `.dev.vars.example` to `.dev.vars` and fill in the same variables. For Docker, set the backend-prefixed variables shown in `docker-compose.yml` in the repository-root `.env`. Keep credentials server-side and out of Git, YAML and frontend `NEXT_PUBLIC_*` variables. Set `BETTER_AUTH_URL` to the public frontend origin and `AUTH_TRUSTED_ORIGINS` to the exact allowed browser origins.",
    "",
    "Without delivery credentials, development can use the generated Mailpit/log fallback. Production fails safely instead of printing OTPs or recovery links. See [the deployment guide](docs/DEPLOYMENT.md) for the complete setup.",
    "",
  ];
}
