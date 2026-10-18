# NordixGen

NordixGen is an internal Nordix tool for generating the starting point of client projects from a declarative YAML configuration. It focuses on the stack Nordix uses and maintains: TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle ORM, PostgreSQL on Neon, Better Auth, TanStack Query, and Zustand.

A generated backend is a modular monolith: business modules run together in one process. Each module may use Clean, Hexagonal, or Onion architecture, and a project may combine these approaches within one backend. Modules communicate through explicit, typed application contracts and direct in-process calls. Project configuration describes the business systemâ€”its repositories and paths, applications and connections, databases, modules, entities, endpoints, pagination, and authentication/authorization needsâ€”rather than selecting unrelated technology stacks.

## Implementation status

The runtime and editor schema now accept strict YAML v2, including module ownership, public imports/exports, authentication and frontend access. Previous schemas and technology selectors are rejected.

**Independent Clean module generation is integrated.** The [direct backend flow](docs/generation/DIRECT_BACKEND.md) prepares files before invoking scaffolds and installations. Multiple Clean modules share one backend and use [typed public application calls](docs/generation/PUBLIC_MODULES.md) with trusted context. Hexagonal/Onion remain unsupported. Focused persistence, identity, browser access, forms and cache-isolation checks pass. A maintained fresh full-stack acceptance check now exercises the connected product; final repository cleanup remains separate work.

## Generate and explore the commerce example

The [full-stack commerce example](examples/full-stack-commerce/README.md) shows a complete two-module application you can generate from its [YAML configuration](examples/full-stack-commerce/project.yaml). Follow its quick start to generate, verify and explore a running local demo with `pnpm example:commerce --keep`, or use the public CLI directly with that YAML. The same example runs in CI as a fresh-generation database/HTTP/browser check. Its README maps the demonstrated features, explains the example helpers, and provides the cleanup command.

## Target generated project

From a `nordix.config.yaml` file, NordixGen scaffolds a Next.js frontend and Hono backend, then generates project code for declared business entities and operations. The generated project includes Drizzle persistence for PostgreSQL/Neon, Better Auth identity and sessions, typed frontend API clients, TanStack Query hooks, Zustand UI state, and entity screens based on connected backend operations.

Authentication screens and access control are separate concerns. The generated sign-in/sign-up UI lets users authenticate; the backend validates sessions and enforces configured roles and permissions. Frontend controls can reflect permissions, while the backend remains responsible for access checks.

Business HTTP operations are described through endpoint declarations. Entity definitions describe data; they do not form the intended API contract by themselves. Health checks and Better Auth handlers are framework-level routes.

NordixGen generates application scaffolding and source code. Cloud deployment configuration, infrastructure provisioning, generated CI/CD, and local Docker environments are separate capabilities and are not part of the generator's current product workflow.

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

The initializer emits a public database-backed example with list/create operations and an optional frontend. Generation prepares supported output, checks prerequisites, runs pinned official scaffolds, installs each repository workspace, and verifies application types and backend boundaries before optional Git/GitHub publication. Configure the emitted environment examples and apply database migrations before starting the applications. See [CLI workflow and evidence](docs/generation/CLI_WORKFLOW.md).

The [approved YAML reference](docs/configuration/YAML_V2.md) defines the target contract. [Validation behavior and evidence](docs/configuration/VALIDATION.md) explains what currently works, how to run checks, diagnostic categories and remaining integration work. The core resolution API builds the [shared project model](docs/configuration/RESOLVED_MODEL.md) independently of generation readiness.

## Development requirements

- Node.js `>=24`
- pnpm `>=10`

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## License

NordixGen is licensed under the [MIT License](LICENSE).
