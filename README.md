# NordixGen

NordixGen is an internal Nordix tool for generating the starting point of client projects from a declarative YAML configuration. It focuses on the stack Nordix uses and maintains: TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle ORM, PostgreSQL on Neon, Better Auth, TanStack Query, and Zustand.

A generated backend is a modular monolith: business modules run together in one process. Clean is the implemented module architecture. Hexagonal and Onion are recognized future families and fail generation readiness until their renderers are implemented. Modules communicate through explicit, typed application contracts and direct in-process calls. Project configuration describes the business systemâ€”its repositories and paths, applications and connections, databases, modules, entities, endpoints, pagination, and authentication/authorization needsâ€”rather than selecting unrelated technology stacks.

## Implementation status

The runtime and editor schema now accept strict YAML v2, including module ownership, public imports/exports, authentication and frontend access. Previous schemas and technology selectors are rejected.

**Independent Clean module generation is integrated.** The [direct backend flow](docs/generation/DIRECT_BACKEND.md) prepares files before invoking scaffolds and installations. Multiple Clean modules share one backend and use [typed public application calls](docs/generation/PUBLIC_MODULES.md) with trusted context. Hexagonal/Onion remain unsupported. Focused persistence, identity, browser access, forms and cache-isolation checks pass. A maintained fresh full-stack acceptance check now exercises the connected product; the same check must pass again after repository cleanup.

## Generate and explore the commerce example

The [full-stack commerce example](examples/full-stack-commerce/README.md) shows a complete two-module application you can generate from its [YAML configuration](examples/full-stack-commerce/project.yaml). Follow its quick start to generate, verify and explore a running local demo with `pnpm example:commerce --keep`, or use the public CLI directly with that YAML. The same example runs in CI as a fresh-generation database/HTTP/browser check. Its README maps the demonstrated features, explains the example helpers, and provides the cleanup command.

## Target generated project

From a `nordix.config.yaml` file, NordixGen scaffolds a Next.js frontend and Hono backend, then generates project code for declared business entities and operations. The generated project includes Drizzle persistence for PostgreSQL/Neon, Better Auth identity and sessions, typed frontend API clients, TanStack Query hooks, Zustand UI state, and entity screens based on connected backend operations.

Authentication supports configurable password/PIN policies (8-character default), Google/GitHub/Microsoft/Facebook OAuth, phone SMS OTP, recovery/reset screens and a basic phone-linking profile. Session durations, company email restrictions and database-backed rate limits are configured per backend; local development supports Mailpit and console simulation, while production fails safely without delivery credentials.

Authentication screens and access control are separate concerns. The generated sign-in/sign-up UI lets users authenticate; the backend validates sessions and enforces static capability requirements using current database roles/grants. The generated `/admin/roles` screen and `/api/auth/iam/*` platform endpoints administer roles and user assignments with separate permissions. Migrations seed initial roles without overwriting later edits; `pnpm auth:create-admin operator@example.com` promotes an existing account. See [identity and IAM](docs/generation/IDENTITY_ACCESS.md).

Authentication and IAM changes are recorded asynchronously in a unified audit store. Declare `audit: true` on a business endpoint to include it; the protected Activity tab provides actor/action/date filters, pagination and before/after inspection. Audit failures do not roll back the primary operation. See [audit logging](docs/generation/AUDIT_LOGGING.md).

Generated frontends support semantic design tokens with per-project light/dark palettes and a persistent Light/Dark/System switcher. Each mode accepts either all seven main colors or none; status colors default individually. See [theme configuration](docs/configuration/YAML_V2.md#frontend-design-tokens-and-theme).

Business HTTP operations are described through endpoint declarations. Entity definitions describe data; they do not form the intended API contract by themselves. Health checks, Better Auth handlers and IAM administration are platform routes.

NordixGen generates application scaffolding, source code, and local Docker environments. Each application receives a multi-stage Dockerfile; each repository receives Compose orchestration for its own applications, dedicated PostgreSQL volumes and Neon HTTP proxies. Run `docker compose up -d --build` or `pnpm docker:up` in a generated repository. See [local Docker usage](docs/generation/CLI_WORKFLOW.md#local-docker-environments). Generated repositories also include Cloudflare native CI/CD commands, a guided account setup assistant, a manual deployment guide and Neon PITR recovery instructions. `develop` deploys staging and `main` deploys production; no generated GitHub Actions runners are required.

## Configure CI/CD with a database

Every generated repository starts with an initial commit on `main` and `develop` pointing to that commit. Creating a GitHub remote remains optional. Publish both branches before connecting deployments.

From the generated repository root, choose either:

1. **Guided assistant:** run `pnpm cicd:setup`. Select your Cloudflare account, GitHub repository, build token and Neon project (or create one). Run `pnpm cicd:setup --profile client-name` to configure another destination. Tokens are masked input or shell environment values; account profiles are ignored by Git.
2. **Manual setup:** follow the generated `docs/DEPLOYMENT.md` to create Neon branches, configure build/runtime secrets and connect each Cloudflare Worker to its Git branch. The guide lists the same build/deploy commands used by the assistant.

Pushes to `develop` deploy staging; pushes to `main` deploy production using native Cloudflare builds. Better Auth remains in the backend. The generated `docs/DISASTER_RECOVERY.md` explains Neon point-in-time recovery. See [the CLI workflow](docs/generation/CLI_WORKFLOW.md#native-cloudflare-cicd-and-neon) for scope and verification.

Try the [Cloudflare CI/CD example](examples/cloudflare-cicd/README.md) for a small public list/create application you can connect to your own accounts.

## Use the CLI

From this checkout, install dependencies with pnpm 10.5.2 and run `pnpm build` first (Node.js 24+). These commands use the current development CLI.

```bash
# Create a starter configuration
node packages/cli/dist/index.js init

# Validate configuration and supported generation readiness
node packages/cli/dist/index.js validate -f nordix.config.yaml

# Generate a supported Clean project into a new or empty directory
node packages/cli/dist/index.js generate -f nordix.config.yaml -o ./my-client-project
```

The initializer emits a public database-backed example with list/create operations and an optional frontend. Generation prepares supported output, checks prerequisites, runs pinned official scaffolds, installs each repository workspace, and verifies application types and backend boundaries before mandatory local Git initialization (initial commit on `main`, `develop` at the same commit) and optional GitHub publication of both branches. Configure the emitted environment examples and apply database migrations before starting the applications. See [CLI workflow and evidence](docs/generation/CLI_WORKFLOW.md).

The [approved YAML reference](docs/configuration/YAML_V2.md) defines the target contract. [Validation behavior and evidence](docs/configuration/VALIDATION.md) explains what currently works, how to run checks, diagnostic categories and supported scope and limitations. The core resolution API builds the [shared project model](docs/configuration/RESOLVED_MODEL.md) independently of generation readiness.

## Development requirements

Generated applications deploy to Cloudflare Workers with private frontend-to-backend service bindings. Optional R2 infrastructure uses OpenTofu, separate staging/production state and native PR plan comments. See [deployment](docs/DEPLOYMENT.md) and [infrastructure](docs/INFRASTRUCTURE.md).

- Node.js `>=24`
- pnpm `>=10`

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## License

NordixGen is licensed under the [MIT License](LICENSE).
