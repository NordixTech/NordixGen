# NordixGen

NordixGen is an internal Nordix tool for generating the starting point of client projects from a declarative YAML configuration. It focuses on the stack Nordix uses and maintains: TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle ORM, PostgreSQL on Neon, Better Auth, TanStack Query, and Zustand.

A generated backend is a modular monolith: business modules run together in one process. Each module may use Clean, Hexagonal, or Onion architecture, and a project may combine these approaches within one backend. Modules communicate through explicit, typed application contracts and direct in-process calls. Project configuration describes the business system—its repositories and paths, applications and connections, databases, modules, entities, endpoints, pagination, and authentication/authorization needs—rather than selecting unrelated technology stacks.

## What NordixGen generates

From a `nordix.config.yaml` file, NordixGen scaffolds a Next.js frontend and Hono backend, then generates project code for declared business entities and operations. The generated project includes Drizzle persistence for PostgreSQL/Neon, Better Auth identity and sessions, typed frontend API clients, TanStack Query hooks, Zustand UI state, and entity screens based on connected backend operations.

Authentication screens and access control are separate concerns. The generated sign-in/sign-up UI lets users authenticate; the backend validates sessions and enforces configured roles and permissions. Frontend controls can reflect permissions, while the backend remains responsible for access checks.

Business HTTP operations are described through endpoint declarations. Entity definitions describe data; they do not form the intended API contract by themselves. Health checks and Better Auth handlers are framework-level routes.

NordixGen generates application scaffolding and source code. Cloud deployment configuration, infrastructure provisioning, generated CI/CD, and local Docker environments are separate capabilities and are not part of the generator's current product workflow.

## Use the CLI

```bash
# Create a starter configuration
npx nordixgen init

# Validate the configuration
npx nordixgen validate -f nordix.config.yaml

# Generate the project
npx nordixgen generate -f nordix.config.yaml -o ./my-client-project
```

Generation uses upstream scaffolding tools for Next.js and Hono, then adds NordixGen's project files. The CLI can also create and push GitHub repositories when the GitHub CLI is installed and authenticated.

The YAML reference and architecture requirements are described in the [project specification](docs/SPECIFICATION.md). The current implementation uses a backend-wide Clean architecture layout; the modular monolith and per-module architecture model describes the intended generated project structure.

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
