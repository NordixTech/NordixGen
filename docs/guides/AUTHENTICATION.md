# Authentication

NordixGen uses Better Auth for identities and sessions. Enable it on a persisted backend, then choose which frontend pages and API operations require login.

## Enable login

Place this fragment on a backend:

```yaml
authentication:
  methods: [email-password]
  features: [email-verification, password-recovery]
  passwordPolicy:
    minLength: 12
    requireUppercase: true
    requireLowercase: true
    requireNumber: true
    requireSpecialChar: true
  session: { expiresIn: 7d, updateAge: 1d }
```

Omitting `authentication` disables identity. An empty object enables default email/password authentication. Default sessions expire after seven days and refresh after one day.

| Option | Supported values |
| --- | --- |
| `methods` | `email-password`, `username-password`, `phone-number` |
| `identityProviders` | `google`, `github`, `microsoft`, `facebook` |
| `features` | `email-verification`, `password-recovery`, `two-factor` |

Username and OAuth providers require email/password support. Two-factor integration does not include a complete enrollment interface; build that flow if your application needs it.

## Password and company policies

Default passwords allow 8–128 characters without required complexity flags. `passwordPolicy` supports min/max length, uppercase, lowercase, number and special-character requirements. Length bounds are 4–128. `numericOnly: true` allows ASCII digits and ignores complexity flags, allowing PIN-style policies.

Set `allowedEmailDomains: [example.com]` for exact company domains. Company registration requires verified email; phone-only signup cannot bypass this boundary. Users verify company email before linking a phone. Browser validation and server password creation/change/reset use the same policy.

## Configure runtime values

Use backend `.dev.vars` locally and backend Worker secrets in deployment. Never put secrets in YAML or the frontend bundle.

| Variables | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection; also supply it to Node database commands |
| `BETTER_AUTH_SECRET` | Authentication secret; use separate staging/production values |
| `BETTER_AUTH_URL` | Frontend origin, normally `http://localhost:3000` locally |
| `AUTH_TRUSTED_ORIGINS` | Exact allowed frontend origins |
| `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Email through Resend |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM` | SMTP alternative; production requires complete credentials and TLS |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS delivery |
| `<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET` | OAuth credentials, such as `GOOGLE_CLIENT_ID` |
| `MICROSOFT_TENANT_ID` | Microsoft tenant; default `common` |

An SMTP host selects SMTP instead of Resend. Register the callback used by the generated Better Auth configuration with each OAuth provider. Verify provider setup and real delivery before releasing to users.

Nonproduction uses configured SMTP/Mailpit or console simulation. Docker includes Mailpit, normally SMTP 1025 and UI 8025. Production fails safely when delivery credentials are missing and does not print reset links or OTPs.

## Account journeys

Email login includes `/forgot-password` and `/reset-password`. Verified matching OAuth identities can link to the same verified local account. OAuth-only accounts need password recovery before password login.

Phone authentication uses E.164 numbers and six-digit SMS OTPs, valid for ten minutes with three verification attempts. `/profile` lets a signed-in account link a verified phone. Unrestricted phone-only registration uses an internal `phone.invalid` placeholder; this is not a verified email identity.

All ordinary signups receive the server-owned default role. To provision the first administrator, apply migrations, register an operator, then run in the generated backend:

```bash
pnpm auth:create-admin operator@example.com
```

The command promotes an existing account; it does not create credentials. See [Roles and permissions](ROLES_PERMISSIONS.md).

## Rate limits

```yaml
rateLimit:
  enabled: true
  ip: { window: 60s, max: 10 }
  account: { window: 15m, max: 10 }
smsOtp:
  dailyLimit: 10
  cooldown: { initialDelay: 60s, multiplier: 2, maxDelay: 15m }
```

These fields belong inside `authentication`. Limits are persisted in PostgreSQL; apply migrations before serving requests. Linked login identifiers share an account budget. SMS quotas/cooldowns remain active even when login rate limiting is disabled. Provider failures consume reserved SMS attempts; cooldown-rejected requests do not.

Durations accept positive seconds or strings ending in `s`, `m`, `h`, `d`. These limits do not provide CAPTCHA, a global delivery spending cap or DDoS protection.

Next: [Page access](PAGE_ACCESS.md) · [Roles and permissions](ROLES_PERMISSIONS.md)
