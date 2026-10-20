# Verified frontend page access

The resolved page inventory is authoritative. `public` leaves business pages accessible; `authenticated` protects every business page; `mixed` protects pages except the validated `publicRoutes` patterns. Sign-in/sign-up remain public. Examples:

```yaml
access: { mode: authenticated, backend: api }
# Or:
access: { mode: mixed, backend: api, publicRoutes: [/, /customer/**] }
```

Patterns must refer to generated pages/subtrees and cannot overlap or include queries/fragments. Authentication pages are automatically public and cannot be listed as business exceptions. Ambiguous identity authorities fail configuration validation instead of choosing the first backend.

Each protected server page awaits `requirePageSession` before rendering content and is marked `force-dynamic`. The helper forwards only the request's Cookie header to `/api/auth/get-session` on the configured selected authority. A cookie's existence grants no access. Fetch uses `no-store`, a five-second timeout and rejects redirects. Missing/invalid/revoked sessions redirect to the fixed local `/sign-in` route; unavailable/malformed identity results fail closed with a safe error, without a redirect loop. Authenticated layouts alone are not relied upon for navigation, actions or API authorization.

Browsers use same-origin /api/auth and /api/iam routes. Next.js forwards these and business /api/backend/<backend>/ routes through named Cloudflare service bindings. The selected backend remains the sole identity/database authority. Cloud backends disable workers.dev and preview URLs; no public HTTP fallback is generated.

Local Node development explicitly uses BACKEND_<NAME>_INTERNAL_URL (localhost:8787 by default). Production Node containers set NORDIX_LOCAL_RUNTIME=1; Cloudflare never enables this override. BETTER_AUTH_URL is the frontend origin, with AUTH_TRUSTED_ORIGINS matching allowed frontends. Docker uses its private bridge and publishes only frontend ports.

`useSessionView` reads identity from Better Auth and effective permissions from the selected backend's `/api/iam/me`, preserving pending versus signed-out state. Account controls and protected mutation controls wait for verified identity and permissions. Permissions refresh on focus, every five seconds and after local IAM mutations; errors clear grants. Sign-out errors remain visible without falsely presenting a successful logout. Zustand only owns notifications, modal and theme UI state. [Operation queries](API_SCREENS.md) use backend/module/operation keys and a fresh, cancelled/cleared QueryClient on each account/role/grant transition; there is no competing identity store. `/admin/roles` always requires a server-side IAM permission check, even when business pages use public access mode.

Evidence: generated guard tests cover every resolved page, public/mixed/authenticated modes, selected URL forwarding, invalid/revoked/fabricated results, unavailable/malformed responses and safe redirects. Real Next.js 15.5.26 builds pass. Local Hono/Better Auth/PostgreSQL plus browser acceptance (using alternate free localhost ports 13000/18787) verified direct private requests -> 307 login, public auth pages -> 200, real login and signed-in account UI, private page rendering, logout and renewed denial. Stopping the isolated identity server yielded 500 with no private screen rendered. The integrated commerce example additionally covers the connected product.

The maintained [commerce example](../../examples/full-stack-commerce/README.md) verifies fresh public-CLI generation, application compilation, Worker bundling, real PostgreSQL migrations/seeds, HTTP authorization, browser forms and account-cache isolation. Run `pnpm example:commerce` from the repository root; each run writes revision, environment and stage/behavior results into a new ignored `tmp/examples/full-stack-commerce/<id>/` directory. This verifies the supported local topology, not cloud deployment or every optional identity-provider journey.
