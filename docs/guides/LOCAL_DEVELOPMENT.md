# Local development

Run these commands in a generated project. For installing the generator and creating output, use [Quick start](../GETTING_STARTED.md).

## With Docker

From each generated repository root:

```bash
docker compose up -d --build
docker compose logs -f
```

Compose builds application images and supplies a dedicated PostgreSQL service/volume and Neon HTTP proxy per persisted backend. Optional integrations add their local services, such as Mailpit, R2 and the MCP gateway. Backend startup applies committed migrations before listening.

Synthetic business seeds run once per database and do not create login accounts. An interrupted/failed seed blocks automatic retry to avoid duplicate data; inspect its database before recovering.

```bash
docker compose down    # Preserve database volumes
pnpm docker:down       # Remove local database volumes too
```

Images use build output; this workflow does not hot reload source. Use host development for that feedback loop.

### Ports and split repositories

The first frontend normally uses port 3000. Override repository-root `.env` values such as `FRONTEND_<NAME>_PORT`, `POSTGRES_<BACKEND>_PORT` and `BACKEND_<NAME>_PORT`; names are uppercase with hyphens replaced by underscores. Backend host ports require the generated `docker-compose.debug.yml` override.

Authentication overrides include `BACKEND_<NAME>_PUBLIC_URL`, `BACKEND_<NAME>_TRUSTED_ORIGINS` and `BACKEND_<NAME>_AUTH_SECRET`. Keep these consistent with your frontend origins. Development default secrets/passwords are not production credentials.

Split repositories share a project-named private bridge. Start the first backend repository before frontend consumers. Browser requests still use the frontend origin; internal calls use the bridge.

## On the host

1. In the backend, copy `.dev.vars.example` to `.dev.vars` and set runtime values.
2. In the frontend, copy `.env.example` to `.env.local`. Its `BACKEND_<NAME>_INTERNAL_URL` values are server-only backend destinations.
3. Set `DATABASE_URL` in the backend's Node shell and apply migrations.
4. Start backend and frontend development commands in separate terminals.

In the generated backend:

```bash
pnpm db:migrate
pnpm dev
```

In the generated frontend:

```bash
pnpm dev
```

Use the generated README for exact application paths and commands. A multi-app repository also has a root workspace `pnpm dev` command. Multiple applications need distinct ports and matching internal URLs. Use one local hostname, normally `localhost`, for identity cookies.

Without authentication, set `CORS_ALLOWED_ORIGINS`. With authentication, configure `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` and exact `AUTH_TRUSTED_ORIGINS`. See [Authentication](AUTHENTICATION.md).

## Database changes

Generation prepares initial SQL. After editing a generated schema:

```bash
pnpm db:generate
# Review and commit SQL plus the migration journal.
pnpm db:migrate
```

`.dev.vars` alone does not supply credentials to Node database scripts. Set their shell environment explicitly. Use `pnpm db:seed` only when synthetic business data is wanted.

## Verify changes

Run generated `pnpm typecheck`, backend `pnpm check:boundaries`, relevant business tests and frontend `pnpm build`. Verify permissions and the user journey, not only compilation.

For local AI chat, set backend provider keys. Docker expects values such as `<BACKEND>_OPENAI_API_KEY`. With MCP enabled, change `MCP_<BACKEND>_PORT` and `<BACKEND>_MCP_PUBLIC_URL` together if the default 8790 is occupied. Wrangler development needs both backend and gateway configurations running for the Service Binding.

Next: [Continue development](../EXTENDING_PROJECTS.md) · [Deployment](../DEPLOYMENT.md)
