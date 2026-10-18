# Verified frontend page access

The resolved page inventory is authoritative. `public` leaves business pages accessible; `authenticated` protects every business page; `mixed` protects pages except the validated `publicRoutes` patterns. Sign-in/sign-up remain public. Examples:

```yaml
access: { mode: authenticated, backend: api }
# Or:
access: { mode: mixed, backend: api, publicRoutes: [/, /customer/**] }
```

Patterns must refer to generated pages/subtrees and cannot overlap or include queries/fragments. Authentication pages are automatically public and cannot be listed as business exceptions. Ambiguous identity authorities fail configuration validation instead of choosing the first backend.

Each protected server page awaits `requirePageSession` before rendering content and is marked `force-dynamic`. The helper forwards only the request's Cookie header to `/api/auth/get-session` on the configured selected authority. A cookie's existence grants no access. Fetch uses `no-store`, a five-second timeout and rejects redirects. Missing/invalid/revoked sessions redirect to the fixed local `/sign-in` route; unavailable/malformed identity results fail closed with a safe error, without a redirect loop. Authenticated layouts alone are not relied upon for navigation, actions or API authorization.

Set `NEXT_PUBLIC_AUTH_BASE_URL` to the absolute root URL of the selected identity backend. A frontend with one backend may fall back to `NEXT_PUBLIC_API_BASE_URL`; multiple connections require the dedicated identity URL. These are public origins, never secrets or caller-selected return URLs. Cookies are never forwarded to a URL from query/body input. Next.js does not create another Better Auth instance or database.

Supported local topology: Next.js on `http://localhost:3000`, Hono on `http://localhost:8787`, backend `BETTER_AUTH_URL=http://localhost:8787`, `AUTH_TRUSTED_ORIGINS=http://localhost:3000`, frontend `NEXT_PUBLIC_AUTH_BASE_URL=http://localhost:8787`. Host-only HttpOnly cookies apply to localhost across both ports. Use localhost consistently rather than mixing localhost, IPs or other hostnames. Browser credentials/CORS and Next server cookie forwarding both participate. Separate hostnames/domains need deliberately configured cookie-domain behavior; this generator does not provision or assume that topology.

`useSessionView` reads identity from Better Auth and effective permissions from the selected backend's `/api/iam/me`, preserving pending versus signed-out state. Account controls and protected mutation controls wait for verified identity and permissions. Permissions refresh on focus, every five seconds and after local IAM mutations; errors clear grants. Sign-out errors remain visible without falsely presenting a successful logout. Zustand only owns notifications, modal and theme UI state. [Operation queries](API_SCREENS.md) use backend/module/operation keys and a fresh, cancelled/cleared QueryClient on each account/role/grant transition; there is no competing identity store. `/admin/roles` always requires a server-side IAM permission check, even when business pages use public access mode.

Evidence: generated guard tests cover every resolved page, public/mixed/authenticated modes, selected URL forwarding, invalid/revoked/fabricated results, unavailable/malformed responses and safe redirects. Real Next.js 15.5.26 builds pass. Local Hono/Better Auth/PostgreSQL plus browser acceptance (using alternate free localhost ports 13000/18787) verified direct private requests -> 307 login, public auth pages -> 200, real login and signed-in account UI, private page rendering, logout and renewed denial. Stopping the isolated identity server yielded 500 with no private screen rendered. The integrated commerce example additionally covers the connected product.

The maintained [commerce example](../../examples/full-stack-commerce/README.md) verifies fresh public-CLI generation, application compilation, Worker bundling, real PostgreSQL migrations/seeds, HTTP authorization, browser forms and account-cache isolation. Run `pnpm example:commerce` from the repository root; each run writes revision, environment and stage/behavior results into a new ignored `tmp/examples/full-stack-commerce/<id>/` directory. This verifies the supported local topology, not cloud deployment or every optional identity-provider journey.
