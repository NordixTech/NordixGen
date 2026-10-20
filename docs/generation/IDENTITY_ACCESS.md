# Shared backend identity and operation access

One Better Auth configuration, handler and platform schema serve every module in a backend. Distinct backends remain distinct authorities. Roles come from the verified session and server-owned account record; ordinary signup always receives the configured least-privilege default role. Additional signup fields cannot select a privileged role.

## Permissions in code, roles in the database

The generated backend uses single-role RBAC: permissions are static, typed application capabilities; roles and grants are dynamic PostgreSQL records. Business endpoints declare `permissions`, never allowed role names. The deprecated endpoint `roles` field accepts only an empty list. Any existing or newly created role with every required permission can execute an operation. The built-in capabilities are `iam:roles:manage` and `iam:users:manage-roles`; other capabilities come from declared backend operation permissions. Unknown initial seed permissions fail validation. The administrator's `*` grant covers known capabilities, never arbitrary unknown permission spellings.

Each module emits its resolved policies once. HTTP preflight and internal application calls use the same application guard and immutable trusted context. The backend verifies the session, then reads the account's current role and grants from the persistence adapter, rather than trusting a stale session role. Grants are loaded for the request; the next request sees role/grant changes without redeployment. There is no worker/isolate permission cache. Missing required identity produces 401; insufficient grants produce 403. A protected HTTP mutation additionally requires a trusted Origin. Internal calls do not fabricate HTTP requests.

The native `nordixIamPlugin` registers `auth_roles` and `auth_role_permissions` with Better Auth. The Drizzle grant table has a text primary identifier, a unique `(role_id, permission)` constraint and a cascading role-to-grant foreign key. Plugin models and snake-case fields match the adapter schema and are discovered by the official Better Auth CLI (`auth@1.7.10`, the successor to `@better-auth/cli`). `auth_user.role` references the role catalog with restricted deletion. Run `pnpm db:generate`, review the SQL and run `pnpm db:migrate` before serving the application. Migrations automatically initialize IAM; `pnpm db:seed` also invokes that initialization before optional synthetic business fixtures.

YAML `authorization.roles`, `adminRole`, `defaultRole` and `rolePermissions` describe initial roles and grants. The declared `adminRole` is initialized with `*` and must not occur in `rolePermissions`; seeding ensures this critical grant even if the role ID already existed. It is protected against deletion and loss of `*`. `defaultRole` must be a different, unprivileged role. Each role is initialized in one atomic SQL statement: `INSERT ... ON CONFLICT DO NOTHING RETURNING id` feeds grant insertion only for a newly created role. Repeated initialization does not restore revoked permissions or change existing metadata/grants on other roles. Newly declared roles are inserted on a future migration/seed run. Editing YAML does not reconcile existing database roles. `pnpm auth:create-admin existing@example.com` promotes an existing account to the configured administrator role.

The configured `adminRole` is a protected system role and always keeps `*`. The configured default role is also protected from deletion, including an existing role newly selected as default. The default role cannot equal `adminRole` or have either IAM management capability or `*`, in YAML or through IAM. Initialization fails if an existing default role has privileged grants; it never silently rewrites those grants. Other system roles cannot be deleted. Custom roles cannot be deleted while any account references them. No passwords or login identities are seeded.

The generated `src/platform/auth/schema.config.ts` exports a schema-only configuration without runtime credentials or database I/O. From the generated backend root, run:

```bash
pnpm dlx auth@1.7.10 generate --config ./src/platform/auth/schema.config.ts --output ./better-auth-discovered.ts --yes
```

Review discovery output alongside the maintained auth/IAM Drizzle schemas. The schema-only entrypoint is never used to serve authentication. Permission statements use Better Auth `createAccessControl`; the first colon separates the resource from its action, remaining colons stay in the action, and a token without colons maps to its own resource with the action `access`. Resources that collide with JavaScript prototype properties receive a `$` prefix in the access-control statement. Public permission tokens and dynamic database grants retain their existing meaning.

## Provision the first administrator

Register the intended account normally, then run this command in the generated backend with `DATABASE_URL` set:

```bash
pnpm auth:create-admin operator@example.com
```

The command promotes only an existing account with that exact email. It does not accept public signup role selection or create credentials. It fails if the account does not exist.

## Automatic platform endpoints

IAM endpoints are registered by `nordixIamPlugin` under `/api/auth/iam` whenever backend authentication is enabled; they are platform routes, not business `endpoints` declarations. `/api/auth` and `/api/auth/iam` are reserved namespaces.

| Route | Required permission |
| --- | --- |
| `GET /api/auth/iam/me` | Verified session; returns the requesting account's current role and permissions |
| `GET /api/auth/iam/permissions` | `iam:roles:manage` |
| `GET /api/auth/iam/roles` | `iam:roles:manage` |
| `POST /api/auth/iam/roles` | `iam:roles:manage`; body has `id`, `name`, optional `description`, concrete `permissions` |
| `PUT /api/auth/iam/roles/:id` | `iam:roles:manage`; updates metadata and/or permissions |
| `DELETE /api/auth/iam/roles/:id` | `iam:roles:manage`; system/assigned roles are rejected |
| `GET /api/auth/iam/role-options` | `iam:users:manage-roles`; only role IDs and display names |
| `GET /api/auth/iam/users?page=1&pageSize=25` | `iam:users:manage-roles`; maximum page size 100 |
| `POST /api/auth/iam/users/:id/role` | `iam:users:manage-roles`; body `{ "role": "existing-role" }` |

Role creation, deletion, grant updates and user-role reassignments run in request-scoped interactive Neon WebSocket transactions with a shared PostgreSQL advisory lock. Each connection closes before its request completes, including errors. Business persistence and ordinary authentication keep the Neon HTTP driver. The existing local Neon proxy supports both HTTP and WebSockets; `NEON_HTTP_PROXY_URL` selects both transports locally. The impact assessment runs in a statement after acquiring the lock, so concurrent changes see the preceding commit. The transaction rechecks the actor's required capability and rejects any change that leaves no account with both IAM capabilities (or `*`), including changes to custom roles. `409` with `code: "last_admin"` cannot be overridden; assign a second full administrator first. These safeguards cover IAM mutations, not direct SQL, authored account deletion, or external identity lifecycle tools; those paths must preserve the same invariant.

Removing either administrative capability from an assigned role or account first returns `409` with `code: "confirmation_required"`, the lost capabilities, affected-account count, self-impact and an impact token. Resubmit the same mutation with `confirmation` set to that token. The SHA-256 token binds the actor, request, current roles/grants and account assignments; changed impact requires a new review. A confirmation does not grant authorization. The browser displays an explicit warning with Cancel focused, including when editing the signed-in user's shared role. After confirmation, it refreshes permissions and returns to the workspace if neither IAM capability remains.

The legacy `auth_iam_audit` table, audit SQL, endpoint and recent-activity panel are no longer generated. Unified application-wide audit logging is deferred to #112; it is not part of this IAM plugin.

Every endpoint verifies the session; every mutation also requires a trusted Origin. Responses are not cached. Role management rejects unknown/duplicate permissions and accepts no new wildcard grants for custom roles. User-role operators may assign any existing role, including `admin`; this is a privileged administrative capability.

The generated Next.js `/admin/roles` page checks permissions on the server before rendering. Either IAM permission grants access; role editing and user assignment are independently displayed and enforced. Role editing includes permission groups and system indicators; user assignment includes a paginated user list and a minimal role selector. Existing business controls consume `/api/auth/iam/me`, not an embedded role dictionary. Browser permissions refresh on focus, every five seconds, and after local IAM changes; backend enforcement remains current on every request. Permission changes also rotate the frontend query cache scope.

HTTP preflight runs before body/parameter validation. A request verifies its Better Auth session once and reuses that verified result for application execution; each application call still checks its own policy and issued context. Controllers do not look up sessions or implement their own permission algorithm. Health/unknown routes do not trigger identity lookup. Transport validation and origin protections remain separate from application authorization.

The fixed password minimum is **12 characters**. `src/project/account-policy.ts` is the generator's authoritative public policy: backend Better Auth enforcement and browser signup constraints/help text consume it. Direct API calls receive the same enforcement. Passwords, session tokens and identity secrets remain outside generated public configuration and YAML.

CI exercises real signup, short-password rejection, signed cookies/session lookup, forged cookies, server-owned default roles and logout revocation using Better Auth with isolated PostgreSQL. IAM tests exercise role creation, validation, protected/assigned-role deletion, current grants and non-destructive initialization. Generated-handler and intermodule tests additionally cover public/401/403/success behavior, permission conjunctions, wildcards, origin checks, fabricated/expired contexts and safe errors. Optional configured providers/email/username/two-factor settings retain their generated backend integration; browser recovery and enrollment journeys remain outside this work.

Project-specific ownership or tenant authorization belongs in authored application use cases/ports alongside their business rules. RBAC does not implement those features. Multiple simultaneous user roles, ABAC expressions and worker cache invalidation remain out of scope.
