# Shared backend identity and operation access

One Better Auth configuration, handler and platform schema serve every module in a backend. Distinct backends remain distinct authorities. Roles come from the verified session and server-owned account record; ordinary signup always receives the configured least-privilege default role. Additional signup fields cannot select a privileged role.

Each module emits its resolved policies once. HTTP preflight and internal application calls use the same application guard: listed roles are alternatives, all required permissions must be granted, `*` grants every permission, and combined role/permission conditions both apply. Missing required identity produces 401; insufficient grants produce 403. A protected HTTP mutation additionally requires a trusted Origin. Internal calls use a trusted operation context and application results without fabricating HTTP requests.

HTTP preflight runs before body/parameter validation. A request verifies its Better Auth session once and reuses that verified result for application execution; each application call still checks its own policy and issued context. Controllers do not look up sessions or implement their own permission algorithm. Health/unknown routes do not trigger identity lookup. Transport validation and origin protections remain separate from application authorization.

The fixed password minimum is **12 characters**. `src/project/account-policy.ts` is the generator's authoritative public policy: backend Better Auth enforcement and browser signup constraints/help text consume it. Direct API calls receive the same enforcement. Passwords, session tokens and identity secrets remain outside generated public configuration and YAML.

CI exercises real signup, short-password rejection, signed cookies/session lookup, forged cookies, server-owned default roles and logout revocation using Better Auth with isolated PostgreSQL. Generated-handler and intermodule tests additionally cover public/401/403/success behavior, role alternatives, permission conjunctions, wildcards, origin checks, fabricated/expired contexts and safe errors. Optional configured providers/email/username/two-factor settings retain their generated backend integration; this does not add unfinished browser recovery, enrollment or administration journeys.

Project-specific ownership or tenant authorization belongs in authored application use cases/ports alongside their business rules. Static roles/permissions do not implement those features.
