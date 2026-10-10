# Phase 4.12 Golden Path Acceptance

This runbook verifies the generated Hono + Clean Architecture + Drizzle + PostgreSQL/Neon backend from the tracked stress fixture in `tools/acceptance/phase-4-12/nordix.yaml`. Generated projects and local environment files go under the ignored `examples/` directory. It uses a disposable PostgreSQL container and a local Neon HTTP proxy; it does not use a hosted database or repository secrets.

## Prerequisites

- Node.js 24 or newer, pnpm 10, and Docker with the Compose plugin.
- The repository dependencies installed with `pnpm install --frozen-lockfile`.
- Ports `55432`, `4444`, and `8787` available.

The Compose stack has no persistent volume. `docker compose down` removes the test database with its containers. The proxy image is pinned by digest so the local acceptance setup does not silently change when its upstream tag moves.

## Build and test NordixGen

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
```

## Generate and initialize the example

Start the disposable database and proxy from the repository root:

```sh
docker compose -f tools/acceptance/phase-4-12/compose.yaml up -d --wait
pnpm exec node packages/cli/dist/index.js validate --file tools/acceptance/phase-4-12/nordix.yaml
pnpm exec node packages/cli/dist/index.js generate --file tools/acceptance/phase-4-12/nordix.yaml --output examples/phase-4-12-acceptance/generated
```

The `examples/` directory is ignored by Git. Run the remaining commands from `examples/phase-4-12-acceptance/generated/apps/api`:

```sh
pnpm typecheck
pnpm db:generate
```

Create a local `.dev.vars` file in that directory with test-only values:

```dotenv
DATABASE_URL=postgres://postgres:nordixgen-local-test@db.localtest.me:5432/nordix_test
BETTER_AUTH_SECRET=phase412-local-test-secret-which-is-at-least-32-characters
BETTER_AUTH_URL=http://localhost:8787
AUTH_TRUSTED_ORIGINS=http://localhost:8787
```

Set the same database URL in the shell before applying migrations and seeding:

```sh
export DATABASE_URL=postgres://postgres:nordixgen-local-test@db.localtest.me:5432/nordix_test
pnpm db:migrate
pnpm db:seed
pnpm dev --ip 127.0.0.1 --port 8787 --local
```

On PowerShell, use `$env:DATABASE_URL = "postgres://postgres:nordixgen-local-test@db.localtest.me:5432/nordix_test"` instead of `export`.

## HTTP acceptance checks

With Wrangler running, exercise these checks from a second terminal. Use an HTTP client that retains cookies between requests:

1. `GET http://127.0.0.1:8787/health` returns `200`.
2. `GET http://127.0.0.1:8787/orders` without a session returns `401`.
3. Sign up with `POST /api/auth/sign-up/email`, sending JSON `{ "name": "Acceptance User", "email": "unique-address@example.test", "password": "Phase412-Test-Password-2026!" }` and `Origin: http://localhost:8787`. Retain the session cookie.
4. With the session, `GET /orders` returns seeded records. `GET /api/orders/summary?status=pending&page=1&pageSize=25` returns only pending orders and a filtered `total`; `GET /api/orders/summary?customerEmail=<seeded-user-email>` exercises a filter on the many-to-one User relation, and `GET /api/orders/summary?itemQuantity=<seeded-quantity>` exercises the one-to-many OrderItem relation. The response includes joined User and OrderItem data and numeric decimal values.
5. Use the session to create an Order with `POST /orders`, then `GET /orders/{id}`, `PATCH /orders/{id}` and `DELETE /orders/{id}`. Supply a `customer_id` from one of the records returned by `GET /users`; send the configured `Origin` header on state-changing requests. Creation must return `201` with `createdAt` and `updatedAt`; after deletion, reading the Order must return `404`.
6. Create and delete a Category through `/categorys`. Reading it after deletion must return `404`, exercising boolean soft delete as well as Order's timestamp soft delete.
7. A session with role `guest` must receive `403` from the protected Order summary endpoint. For a local-only check, create a second account and update its `auth_user.role` in the disposable database to `guest` before the request.

The repository smoke test performs these checks, including the local role update, with Node's built-in `fetch` and Docker Compose:

```sh
node tools/acceptance/phase-4-12/smoke-test.mjs
```

## Determinism and diagnostics

Generate the same YAML into two empty output directories. Compare their `apps/api/src` file paths and SHA-256 hashes; the paths and hashes must match. Generated SQL migration filenames may differ because Drizzle Kit supplies its own migration naming.

For pre-generation diagnostics, make temporary copies of the acceptance YAML and set `backends[0].persistence.orm` to `unknown-orm` or change the database engine to `mysql` while keeping the Neon provider. Run `nordixgen generate` against each copy. It must exit nonzero with a diagnostic and must not create either output directory.

## Cleanup

Stop Wrangler, then run from the repository root:

```sh
docker compose -f tools/acceptance/phase-4-12/compose.yaml down --remove-orphans --volumes
```

The generated example and any local environment files remain under ignored `examples/`; do not force-add them.
