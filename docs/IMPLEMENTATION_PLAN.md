# NordixGen implementation plan

This document tracks the current implementation and the approved simplification path. NordixGen is an internal Nordix project generator for a fixed stack, not a general-purpose framework/plugin platform. The v1.1.0 milestone is dedicated exclusively to the refactor from the legacy generic composition design to a modular-monolith generator.

## Product target

Generated projects use TypeScript, Next.js App Router, Tailwind, Hono, Drizzle, PostgreSQL on Neon, Better Auth, TanStack Query, and Zustand. These are fixed stack choices, not YAML selectors. A backend is a modular monolith; each business module selects Clean, Hexagonal, or Onion architecture. Modules communicate through explicit typed public application contracts and direct in-process calls.

Current implementation is not yet at this target. The current schema selects architecture per backend, Clean is the only registered architecture generator, and the current output lacks module ownership and intermodule contracts. The YAML v2/module design in [RF-03](https://github.com/NordixTech/NordixGen/issues/64) is a design target, not a currently accepted configuration.

## Current repository status

The pnpm workspace contains `@nordixgen/core` and `@nordixgen/cli`. The core parses YAML, validates schema and project semantics, builds a normalized representation, and renders files through an in-memory file system. The CLI provides `init`, `validate`, and `generate`, invokes upstream scaffolding tools, writes project files, and can create/push GitHub repositories through `gh`.

Current generation includes Next.js frontend, Hono backend, Clean-layered backend output, Drizzle/PostgreSQL-Neon persistence, Better Auth, static role/permission checks, connected frontend API clients/hooks/screens, and both declared endpoint routes and entity-derived CRUD routes. The latter is explicitly removed from target behavior by [RF-02](https://github.com/NordixTech/NordixGen/issues/63).

`authUI` produces login/signup UI and account controls; it does not protect frontend pages. Better Auth session validation and backend role/permission authorization are separate. The current role/permission model is static and does not provide a general policy engine.

## v1.1.0 refactor issues

- [RF-01 / #65: Align project documentation with the fixed-stack direction](https://github.com/NordixTech/NordixGen/issues/65) — correct documentation and distinguish implemented behavior from target and future work.
- [RF-02 / #63: Generate business HTTP routes only from declared endpoints](https://github.com/NordixTech/NordixGen/issues/63) — remove entity-derived business HTTP routes.
- [RF-03 / #64: Design YAML v2 modules, architecture families and typed intermodule contracts](https://github.com/NordixTech/NordixGen/issues/64) — define the business-module model, per-module architecture choice, ownership and communication semantics.

RF-03 and RF-02 can progress independently: RF-03 specifies the endpoint invariant for the future schema, while RF-02 corrects current generated output. The milestone is limited to reducing generic plugin/framework complexity and delivering the fixed-stack modular-monolith direction. See the [milestone](https://github.com/NordixTech/NordixGen/milestone/2).

## Existing functionality outside this initial refactor slice

Existing useful configuration and generation behavior remains relevant unless a refactor issue explicitly changes it: repositories and paths, frontend/backend connections, named databases, entities and relations, endpoint inputs/outputs, pagination, auth settings, migrations/seeds, and generated frontend clients/screens. The target schema can simplify fixed technology selectors while retaining these project-specific declarations.

## Future work after v1.1.0

Client deployment configuration, cloud provisioning, generated CI/CD, IaC/Terraform, generated Docker development environments, and LLM tooling have not been implemented in this repository. These are possible later projects and are not deliverables or prerequisites of v1.1.0. The repository's own CI/release pipeline publishes NordixGen packages; it does not generate deployment workflows for client projects. The current Hono upstream Cloudflare Worker scaffold is not proof of client deployment support.

## Working conventions

- Keep product and maintained technical documentation in English.
- Verify claims against generator source and generated examples; label planned behavior as planned.
- Prefer simple typed functions and one resolved project model over general-purpose registries/capability negotiation.
- Keep parser, structural/semantic validation, safe file generation, path checks, and collision diagnostics where useful.
- Make module ownership, public contracts, actor propagation, dependency validation, and failure semantics explicit before implementing cross-module calls.
- Keep deployment, IaC, generated CI/CD, Docker and LLM work outside this milestone.
