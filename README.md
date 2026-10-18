# NordixGen

NordixGen is an internal Nordix tool for generating the starting point of client projects from a declarative YAML configuration. It focuses on the stack Nordix uses and maintains: TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle ORM, PostgreSQL on Neon, Better Auth, TanStack Query, and Zustand.

A generated backend is a modular monolith: business modules run together in one process. Each module may use Clean, Hexagonal, or Onion architecture, and a project may combine these approaches within one backend. Modules communicate through explicit, typed application contracts and direct in-process calls. Project configuration describes the business systemâ€”its repositories and paths, applications and connections, databases, modules, entities, endpoints, pagination, and authentication/authorization needsâ€”rather than selecting unrelated technology stacks.

## Implementation status

The runtime and editor schema now accept strict YAML v2, including module ownership, public imports/exports, authentication and frontend access. Previous schemas and technology selectors are rejected.

**Single Clean module generation is integrated.** The [direct backend flow](docs/generation/DIRECT_BACKEND.md) prepares files before invoking scaffolds and installations. Multiple Clean modules require the next module-layout integration; Hexagonal/Onion remain unsupported. Full database/browser acceptance is still pending.

## Target generated project

From a `nordix.config.yaml` file, NordixGen scaffolds a Next.js frontend and Hono backend, then generates project code for declared business entities and operations. The generated project includes Drizzle persistence for PostgreSQL/Neon, Better Auth identity and sessions, typed frontend API clients, TanStack Query hooks, Zustand UI state, and entity screens based on connected backend operations.

Authentication screens and access control are separate concerns. The generated sign-in/sign-up UI lets users authenticate; the backend validates sessions and enforces configured roles and permissions. Frontend controls can reflect permissions, while the backend remains responsible for access checks.

Business HTTP operations are described through endpoint declarations. Entity definitions describe data; they do not form the intended API contract by themselves. Health checks and Better Auth handlers are framework-level routes.

NordixGen generates application scaffolding and source code. Cloud deployment configuration, infrastructure provisioning, generated CI/CD, and local Docker environments are separate capabilities and are not part of the generator's current product workflow.

## Use the CLI

```bash
# Create a starter configuration
npx nordixgen init

# Validate configuration and generation readiness (currently exits 1 for valid v2)
npx nordixgen validate -f nordix.config.yaml

# Generation remains blocked until modular integration is complete
npx nordixgen generate -f nordix.config.yaml -o ./my-client-project
```

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
