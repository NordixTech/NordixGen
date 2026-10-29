# Deployment and CI/CD

Generated applications deploy to Cloudflare Workers. Next.js uses OpenNext; Hono remains a private backend Worker. PostgreSQL is hosted by Neon.

## Connect the repository

Each generated repository starts with `main` and `develop` at the initial commit. Publish both branches to GitHub, then run from its root:

```bash
pnpm cicd:setup
```

The standalone assistant selects your Cloudflare account, GitHub repository, build token and Neon project, or creates a Neon project. To configure another destination, use:

```bash
pnpm cicd:setup --profile client-name
```

Account profiles are ignored by Git; credentials use masked input or shell variables. The generator itself does not need to be installed in the generated project.

Prefer manual configuration? Follow that repository's generated `docs/DEPLOYMENT.md`, which lists its exact build/deploy commands and required secrets.

## Branch workflow

| Branch | Environment |
| --- | --- |
| `develop` | Staging |
| `main` | Production |

Native Cloudflare Workers Builds checks out the triggering revision, runs the repository's build command and deploys the Worker. Each application has its own trigger. No GitHub Actions deployment runner is generated, and application Workers do not run CI themselves.

Backend checks run before committed migrations and deployment. Frontends build through OpenNext. Keep SQL/journals in Git and review destructive migrations before merging. Setup creates persistent Neon branches for the destination environments; Better Auth stays inside the backend rather than using Neon Managed Auth.

## Private connections and public integrations

Browsers call the frontend's same-origin API routes. Frontend server requests use named Service Bindings to the correct backend. Backend `workers.dev` and preview URLs are disabled; cloud execution has no public HTTP fallback.

An enabled MCP gateway is a separate public Worker with a private backend binding. Set its public origin and backend `MCP_PUBLIC_URL`. [R2 infrastructure](INFRASTRUCTURE.md) applies before consumer deployment; split repositories must deploy the infrastructure owner first when resources change.

Store database/auth/provider/signing credentials in their intended backend/build secrets. Use different staging and production secrets and exact frontend trusted origins.

## Backend placement

Backend Workers initially use Smart Placement; frontend Workers remain at the edge. Setup can choose an independent Cloudflare backend region reference while showing the Neon region. It preserves the selection through `NORDIX_WORKER_PLACEMENT`.

For manual configuration, set the environment's `placement.region`, such as `aws:us-east-1`, or retain Smart Placement. Selecting placement does not move an existing Neon project, increase Worker CPU/memory or guarantee lower latency. Measure the actual workload.

## Verify a deployment

Check the frontend, proxied backend health, database reads/writes, anonymous denial, login/logout, protected server navigation and insufficient-permission denial. Backend public URLs should remain inaccessible. Test configured email/SMS/OAuth, storage transfers and AI/MCP in the destination environment as applicable.

## Recovery

Every generated repository includes `docs/DISASTER_RECOVERY.md` for Neon point-in-time recovery. Retention depends on the account plan. Rehearse restores and measure recovery objectives for the application. Committed migration history does not replace data recovery.

Back up OpenTofu state independently. Off-site R2 database backups and automatic cross-module rollback are not generated.
