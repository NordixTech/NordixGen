# NordixGen

NordixGen is an internal Nordix tool for generating the starting point of client projects from a declarative YAML configuration. It targets one stack that Nordix knows and maintains. Public availability does not make it a general-purpose framework or third-party plugin platform.

The generator currently has a legacy plugin-based implementation. Milestone [v1.1.0](https://github.com/NordixTech/NordixGen/milestone/2) is dedicated to simplifying that implementation and establishing the fixed-stack modular-monolith design. The new YAML and module architecture described below are refactor targets; the current release does not accept or generate them yet.

## Product direction

The fixed stack is TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle ORM, PostgreSQL on Neon, Better Auth, TanStack Query, and Zustand. These are product decisions, not technology choices a project selects in YAML.

Each generated backend is intended to be a modular monolith. Business modules share one process and runtime. Each module will select one internally supported architecture: Clean, Hexagonal, or Onion. A backend may mix these families. Modules will communicate through explicit typed application contracts and direct in-process calls, with ownership and dependency rules defined by the new YAML/model.

**Current support differs from that target:** current generated backend output uses Clean Architecture. The current schema also accepts `modular`, but there is no registered generator for it. Hexagonal, Onion, per-module architecture selection, and typed module contracts are not implemented yet. See [RF-03](https://github.com/NordixTech/NordixGen/issues/64) for the YAML/module design and [RF-02](https://github.com/NordixTech/NordixGen/issues/63) for the explicit business-route change.

## What the current generator does

The repository contains two workspace packages: `@nordixgen/core` for YAML parsing, schema and semantic validation, the normalized project model, and generated-file composition; and `@nordixgen/cli` for `init`, `validate`, and `generate` commands. Generation currently creates Next.js and Hono project scaffolds and adds configured entities, endpoints, persistence, authentication, frontend API clients, hooks, and screens.

Supported project configuration includes repositories and paths, frontend-to-backend connections, named database resources, entities and their fields/relations, endpoints, pagination, and project-specific authentication and role/permission settings. A backend currently references one database resource. The target schema may simplify technology selectors while retaining these project-level choices.

`authUI: true` generates sign-in/sign-up UI and account controls. It does not require a login to view frontend pages or add a server-side page access gate. Better Auth handles identity and sessions; generated backend routes enforce configured roles and permissions. The existing authorization is a static role-to-permission check, not a general policy engine. Frontend permission-based visibility is only a UI aid; the backend remains responsible for authorization.

The current generator also creates entity-based CRUD routes in addition to routes declared under `endpoints`. RF-02 changes the target behavior so only explicitly declared business endpoints are generated. Health and Better Auth handlers remain platform routes.

## Run the CLI

```bash
npx nordixgen init
npx nordixgen validate -f nordix.config.yaml
npx nordixgen generate -f nordix.config.yaml -o ./my-client-project
```

The CLI can initialize/publish repositories through GitHub CLI when configured. Generation uses upstream scaffolding tools for Next.js and Hono; this is project scaffolding, not deployment provisioning.

The current YAML is documented in the [specification](docs/SPECIFICATION.md). Do not use the illustrative v2 module YAML in the RF-03 design issue as input to the current generator.

## Development requirements

- Node.js `>=24`
- pnpm `>=10`

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## Refactor status and future work

The v1.1.0 milestone covers the fixed-stack refactor, including the module/YAML design and explicit endpoint exposure. Deployment configuration, cloud provisioning, generated client-project CI/CD, IaC, Docker environment generation, and LLM tooling are not currently implemented and are outside this milestone; they are future product decisions.

- [v1.1.0 refactor milestone](https://github.com/NordixTech/NordixGen/milestone/2)
- [RF-01: Align project documentation with the fixed-stack direction](https://github.com/NordixTech/NordixGen/issues/65)
- [RF-02: Generate business routes only from declared endpoints](https://github.com/NordixTech/NordixGen/issues/63)
- [RF-03: Design YAML v2 for a modular monolith with per-module architectures](https://github.com/NordixTech/NordixGen/issues/64)
- [Detailed requirements and implementation status](docs/SPECIFICATION.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Workspace packages](packages/README.md)

## Language standard

Source code, CLI output, identifiers, comments, commits, pull requests, issues, and maintained project documentation are written in English. Conversations may use Spanish.

## License

NordixGen is licensed under the [MIT License](LICENSE).
