# Configure authentication and account journeys

Use this guide for setup and verification. The [YAML reference](../configuration/YAML_V2.md#8-backend-identity-and-operation-access) defines exact defaults and restrictions; [identity/IAM](IDENTITY_ACCESS.md) describes role administration and endpoint contracts.

## Select identity and access before generation

Authentication is disabled when backend `authentication` is omitted; `{}` enables default email/password authentication and requires persistence. Supported methods are email/password, username/password and phone-number OTP. Username and supported OAuth providers require email/password. OAuth providers are Google, GitHub, Microsoft and Facebook. Features include email verification, password recovery and two-factor support; configuration does not imply a complete enrollment interface for every feature/provider.

The following is a backend fragment, not a complete project:

```yaml
authentication:
  methods: [email-password, phone-number]
  features: [email-verification, password-recovery]
  passwordPolicy:
    minLength: 12
    requireUppercase: true
    requireLowercase: true
    requireNumber: true
    requireSpecialChar: true
  session: { expiresIn: 7d, updateAge: 1d }
```

Default password length is 8–128 characters with no required complexity flags. `numericOnly` supports a PIN policy and overrides complexity requirements; choose a policy appropriate to the client rather than copying a short example PIN. `allowedEmailDomains` enforces exact company domains and verified email. Company users must verify their company identity before linking a phone; phone-only signup cannot bypass that restriction.

Set frontend `access.mode` to `authenticated`, `mixed` or `public` independently of endpoint access. A frontend with multiple authenticated connections must select its authority explicitly; secured operations from unrelated authorities are unsupported. On an authentication-enabled backend, endpoints require login by default. Set `authRequired: false` explicitly only for intentionally public operations with no permission requirements.

## Configure runtime secrets and delivery

Use the generated backend `.dev.vars.example` locally and Worker secrets in cloud environments. Database scripts also need the same `DATABASE_URL` in the Node shell. Never put credentials in YAML or frontend environment values.

| Setting | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Backend session/authentication secret; use independent values for staging and production. |
| `BETTER_AUTH_URL` | Frontend public origin used by browser authentication, normally `http://localhost:3000` locally. |
| `AUTH_TRUSTED_ORIGINS` | Exact allowed frontend origins for protected browser mutations. |
| `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Email delivery via Resend when SMTP is not selected. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM` | SMTP alternative; production requires complete credentials and TLS. An SMTP host selects this path rather than falling back to Resend. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS OTP delivery. |
| `<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET` | Credentials for each configured OAuth provider, using uppercase provider names. Register the callback emitted by the generated Better Auth configuration with that provider. |
| `MICROSOFT_TENANT_ID` | Microsoft tenant, default `common`. |

Use the generated repository's environment examples for the fields emitted by your configuration. Local nonproduction delivery uses configured SMTP/Mailpit or console simulation. Docker includes Mailpit, normally SMTP port 1025 and UI port 8025. Keep simulation confined to development. Missing production delivery credentials fail the journey with a safe error instead of printing OTPs/reset links. Verify real delivery in the destination environment before enabling user recovery or verification.

## Migrate and provision administration

Apply committed migrations before serving auth requests. They include Better Auth tables, IAM roles/grants and database-backed abuse counters/function. Register an operator through the normal flow, then run in that backend:

```bash
pnpm auth:create-admin operator@example.com
```

The command promotes an existing account; it does not create credentials. Business seeds create no login identities. Open `/admin/roles` to manage roles/users using separate IAM permissions. YAML roles/grants initialize newly inserted roles; changing them does not overwrite existing administrator edits. See [IAM protections](IDENTITY_ACCESS.md).

## Understand journeys and limits

Email authentication provides `/forgot-password` and `/reset-password`, including token and password-policy checks. Verified matching OAuth identities can link to the same verified local account; an OAuth-only account needs password recovery before password login. Phone login uses E.164 numbers and six-digit OTPs, valid for ten minutes with three verification attempts. `/profile` links a verified phone to an existing signed-in account. Unrestricted phone-only registration uses an internal `phone.invalid` placeholder, not a verified email identity.

Login throttling has separate IP and account budgets. Linked identifiers share the account budget; database persistence prevents restart bypass. SMS quotas/cooldowns apply independently even when login rate limiting is disabled. Reservations happen before delivery, so provider failures still consume an attempt. These controls do not provide a global delivery spending limit, permanent lockout, CAPTCHA or DDoS protection.

Test successful and invalid login, reset/verification delivery, password policy, configured OAuth callbacks, phone linking, cooldowns, company-domain restrictions, permissions and logout. Use one local hostname consistently for session cookies. Server page guards and backend grants must still deny access if a client manipulates UI state. The [troubleshooting guide](../TROUBLESHOOTING.md) covers common setup failures.
