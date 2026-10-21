# Generate and run your first project

## Prepare the generator checkout

Install Node.js 24+, pnpm 10.5.2 and Git. Configure a Git author name and email: generation always creates an initial commit on `main` and a `develop` branch at that commit. Network access is needed for the pinned scaffolders and dependency installation. GitHub CLI authentication is needed only for optional remote publication. Docker Engine with Compose v2 is needed for the Docker workflow, not for configuration validation.

Run in the NordixGen checkout:

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js init
node packages/cli/dist/index.js validate -f nordix.config.yaml
node packages/cli/dist/index.js generate -f nordix.config.yaml -o ./my-client-project
```

`init` asks for the name, optional frontend and configuration location. It creates a persisted Clean example with explicit public list/create endpoints. Use your chosen configuration path with `-f` if it differs from the example above. The output must be new or empty. Configuration/readiness failures occur before generation effects; later scaffold/install failures can leave partial output for inspection. Use another empty target after resolving the cause.

## Choose and adapt a configuration

Start with the initializer for the smallest project. Use the [commerce fixture](../examples/full-stack-commerce/project.yaml) for an integrated backend/frontend example, [mixed modules](../examples/configuration/mixed-modules.yaml) for architecture combinations, or the [performance fixture](../examples/performance/project.yaml) for two frontends, storage, audit, roles and indexes. These are test/example inputs, not production policies; review permissions, rate limits, names and synthetic data before adopting them.

Declare repositories and application paths, a dedicated named database per persisted backend, modules with exclusive entity ownership, then explicit endpoints. Add a frontend with `connectsTo` for the backends it consumes. Entities alone create no business routes or CRUD screens. See the [YAML reference](configuration/YAML_V2.md) for complete syntax, field types, relations, indexes, joins and pagination. Validate after each configuration change.

## Run with Docker

In each generated repository root:

```bash
docker compose up -d --build
docker compose logs -f
```

Use the generated README and Compose file to locate the frontend ports; the first frontend normally uses `http://localhost:3000`. Persisted backends receive local PostgreSQL and a Neon HTTP proxy. Startup applies committed migrations and runs synthetic seeds once per local database. Seeds do not create login identities. Backends stay on the private bridge unless the debug override is selected.

For split repositories, start the first backend repository before frontend consumers so the shared bridge exists. Use the repository-root `.env` overrides documented in the [Docker workflow](generation/CLI_WORKFLOW.md#local-docker-environments) when ports collide. This workflow builds images and has no source hot reload.

```bash
docker compose down     # Stop and preserve local database volumes
```

`pnpm docker:down` also removes volumes. Use that generated shortcut only when deleting the local data is intended. Never use database-reset acceptance scripts against a client database.

## Run on the host

In the generated backend, copy `.dev.vars.example` to `.dev.vars` and configure the database and any auth settings. In the frontend, copy `.env.example` to `.env.local`; its `BACKEND_<NAME>_INTERNAL_URL` values are server-only destinations, not public browser API URLs. Use the same hostname, normally `localhost`, for local identity cookies.

Database tooling runs in Node and also needs `DATABASE_URL` in the shell environment. In the generated backend:

```bash
pnpm db:migrate
pnpm dev
```

Generation prepares initial migration SQL. For later schema changes, run `pnpm db:generate`, review and commit the new SQL/journal, then migrate. `pnpm db:seed` is optional synthetic business data. Start the generated frontend with `pnpm dev` in another terminal. Assign distinct ports and matching internal URLs when using multiple backends. Check the generated README for project-specific commands.

## Enable identity and verify the result

The starter is public. To generate identity, configure backend `authentication` and an appropriate frontend `access` policy before generation. Set a backend auth secret, the frontend origin as `BETTER_AUTH_URL`, and exact trusted origins. Apply migrations, register an operator account, then run `pnpm auth:create-admin operator@example.com` in that backend with the same database connection. Use `/admin/roles` for subsequent role/grant administration. Follow [authentication setup](generation/AUTHENTICATION.md) for delivery and provider settings.

Verify list/create behavior and persistence after restart. With identity, also verify anonymous denial, login, insufficient-permission denial and logout. Run generated `pnpm typecheck` and backend `pnpm check:boundaries` after editing code.

## Continue into development and deployment

NordixGen initializes projects once. Continue by editing generated source and migrations using the [extension guide](EXTENDING_PROJECTS.md); do not regenerate over edited applications. Commit the project and publish `main` and `develop` if using GitHub. Then run generated `pnpm cicd:setup` or follow its generated deployment guide. `develop` targets staging and `main` production through native Cloudflare builds. Generation itself makes no cloud changes. Review [deployment](DEPLOYMENT.md), [infrastructure](INFRASTRUCTURE.md) and the generated recovery guide before the first production release.
