# NordixGen

Generate a TypeScript application from YAML: Hono APIs, Next.js screens, PostgreSQL persistence, authentication and deployment setup.

NordixGen is built by Nordix to make client-project setup consistent. Define the business model and operations once, then continue developing in ordinary application source code.

## Get started

Use Node.js 24.22.1+, pnpm 10.5.2 and Git with a configured author name and email.

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js init
node packages/cli/dist/index.js validate -f nordix.config.yaml
node packages/cli/dist/index.js generate -f nordix.config.yaml -o ./my-project
```

Generation requires network access and a new or empty output directory. Each generated repository starts with an initial commit on `main` and a `develop` branch. Creating a GitHub remote is optional.

## What is included?

- Modular Hono backends with Clean, Hexagonal or Onion architecture.
- Next.js App Router frontends with Tailwind, TanStack Query and Zustand.
- Drizzle schemas and migrations for PostgreSQL/Neon.
- Better Auth, dynamic roles and permissions, and audit logging.
- Optional R2 document storage, AI chat and MCP tools.
- Docker environments and native Cloudflare CI/CD.

NordixGen initializes new projects. It does not regenerate over edited applications. Generated applications run independently of the generator.

**[Read the documentation →](docs/README.md)**

Start with [Quick start](docs/GETTING_STARTED.md), explore [project structure](docs/configuration/PROJECT_STRUCTURE.md), or use the [YAML reference](docs/configuration/YAML_V2.md).

## Examples

| Example | Includes |
| --- | --- |
| [Notes](examples/configuration/single-module.yaml) | One persisted module and a filtered list |
| [Mixed architectures](examples/configuration/mixed-modules.yaml) | Modules using different architecture families |
| [Commerce](examples/full-stack-commerce/project.yaml) | A connected backend and frontend |
| [Larger application](examples/performance/project.yaml) | Two frontends, storage, audit, permissions and indexes |

Only YAML inputs are versioned under `examples/`; generate into an ignored `generated/` directory. Example policies and synthetic data should be adapted before production use.

## Development

See [Contributing](docs/CONTRIBUTING.md) for setup and checks.

## License

[MIT](LICENSE).
