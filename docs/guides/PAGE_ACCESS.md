# Page access

Frontend page access controls navigation and server rendering. Backend endpoint permissions independently control data access.

## Choose an access mode

Place `access` on a frontend:

```yaml
access: { mode: authenticated, backend: api }
```

| Mode | Behavior |
| --- | --- |
| `public` | Business pages are public; this is the default |
| `authenticated` | Every generated business page requires a verified session |
| `mixed` | Pages are protected except declared public routes |

For a mixed site:

```yaml
access:
  mode: mixed
  backend: api
  publicRoutes: [/, /product/**]
```

`/product/**` matches `/product` and descendants, not `/products`. Patterns must match generated pages. Queries, fragments, dynamic placeholders, overlapping/redundant patterns and `/**` are rejected. Use public mode if all pages should be public.

Sign-in/sign-up are always public entry pages and must not be listed as exceptions. IAM, audit and enabled AI interfaces retain their own server-side access checks.

## Select one identity authority

`access.backend` must be a connected authentication-enabled backend. It is inferred when exactly one authenticated connection exists; select it explicitly when there are several.

A frontend cannot consume secured browser operations from a different identity authority. Public operations from other connected backends are allowed. Cross-backend SSO is not provided.

## How protection works

Each protected server page verifies the session with the selected backend before returning private content. Cookie presence alone is insufficient. Expired/revoked sessions redirect to `/sign-in`; unavailable or malformed identity responses fail closed with a safe error.

Protected pages are dynamic and session requests are not shared-cached. Browser session and permission helpers control presentation only. The backend still enforces every operation's access policy.

For local development, use one hostname consistently, normally `localhost`, with distinct ports. Set `BETTER_AUTH_URL` to the frontend origin and exact `AUTH_TRUSTED_ORIGINS`. Keep frontend internal backend URLs server-only.

New pages authored after generation need explicit server guards. The original generated page inventory does not automatically secure later additions.

Next: [Authentication](AUTHENTICATION.md) · [Roles and permissions](ROLES_PERMISSIONS.md)
