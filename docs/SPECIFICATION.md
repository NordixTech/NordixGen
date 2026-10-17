# NordixGen: Product specification and implementation status

This document describes NordixGen as it exists today and the approved product direction for the v1.1.0 refactor. It separates current implementation, refactor target, and future work so readers do not mistake plans for shipped generator behavior.

## 1. Product purpose and boundary

NordixGen is an internal Nordix tool for generating a maintainable starting point for new client projects from YAML. It is built around one fixed stack Nordix understands and maintains; it is not a general-purpose framework adapter or a public third-party plugin platform. Public availability does not change that product boundary.

The fixed stack is TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle ORM, PostgreSQL on Neon, Better Auth, TanStack Query, and Zustand. Project YAML should express the project being generated (its repositories, paths, connected applications, named databases, business modules, entities, endpoints, pagination, and relevant auth/authorization settings), not choose among unrelated stacks or state libraries.

Each backend is intended to be a modular monolith: business modules share a process and runtime. Every business module selects one internal architecture family: Clean, Hexagonal, or Onion. Families may coexist within one backend. The application contract between modules is explicit, typed, and called directly in-process. A module imports only declared public application operations from another module; it must not reach into its repository, database tables, HTTP controllers, or private implementation. This is a target contract, not a description of today's generated layout.

## 2. Current implementation and refactor target

The repository currently contains `@nordixgen/core` and `@nordixgen/cli`. The core parses YAML with the `yaml` library, validates the result with Zod and semantic validators, normalizes entities/endpoints into an intermediate representation, and composes generated files. The CLI offers `init`, `validate`, and `generate` and orchestrates upstream scaffolds and output.

Current generator internals use plugin contracts, registries, compatibility/capability checks, and separate frontend/backend composition paths. Those are implementation mechanisms in the current code, not a supported extension promise. v1.1.0 removes this unnecessary generality in favor of direct, typed functions for the fixed stack.

The current backend schema selects architecture at backend level. The CLI registers a Clean architecture implementation. The schema accepts `modular`, but no generator is registered for it. Hexagonal, Onion, business-module ownership, module imports/exports, and a new per-module YAML design are not implemented. The current Clean output has global layer directories and does not enforce module boundaries. The existing YAML remains the only accepted input until the schema and generator changes land.

The backend scaffold currently uses Hono's upstream Cloudflare Workers template. That scaffold choice does not mean NordixGen generates client deployment configuration, provisions Cloudflare resources, or deploys applications.

### Current capability summary

| Area | Current state |
| --- | --- |
| YAML parse/schema/semantic validation and generated editor schema | Implemented for current YAML |
| Next.js frontend and Hono backend scaffolding | Implemented |
| Clean backend layer generation, entities and declared endpoints | Implemented |
| Entity-derived automatic CRUD controllers/routes | Also currently generated; RF-02 removes these from the target output |
| Drizzle persistence with PostgreSQL/Neon | Implemented; each backend references one named database resource |
| Multiple named database resources in a project | Supported; multiple simultaneous connections inside one backend are not supported |
| Better Auth sessions, auth forms, route auth and static role/permission checks | Implemented with limits described below |
| Frontend clients, server-state hooks and entity screens | Implemented from connected backend contracts |
| GitHub remote repository creation/push | Available through configured `gh` CLI |
| Per-business-module Clean/Hexagonal/Onion and typed intermodule calls | v1.1.0 target, not implemented |
| Client deployment, cloud provisioning, generated CI/CD, IaC, Docker environment, LLM tooling | Future work; not implemented and outside v1.1.0 |

## 3. Configuration concepts

Current YAML supports repositories and repository paths, frontend/backend declarations and connections, named database resources, entities, fields and relations, endpoint declarations and request/response details, pagination, and authentication/authorization settings. Multiple databases can be declared and selected by backends. The current backend persistence shape references one database resource per backend.

The refactor simplifies fixed technologies out of project configuration. Frontend framework and styling, backend framework, ORM, database engine/provider, auth implementation, and state library are not intended to be user-selectable. Architecture remains configurable only within the finite internal set, and it is selected per business module, not per backend. Exact YAML v2 syntax and semantic rules are owned by [RF-03](https://github.com/NordixTech/NordixGen/issues/64); draft snippets elsewhere are illustrations and are not accepted by the current CLI.

Entities define business data. Endpoints define business operations exposed over HTTP, including method/path, inputs, pagination, authentication and permissions as supported by the schema. The target rule in [RF-02](https://github.com/NordixTech/NordixGen/issues/63) is that an entity alone creates no business route: only explicitly declared endpoints do. Health checks and Better Auth's handler are infrastructure routes.

The refactor does not define deployment, IaC, or generated CI/CD keys. Secrets remain outside versioned project YAML and should be supplied through the runtime/deployment environment when those future workflows are designed.

## 4. Parsing, validation, and generation flow

Today the YAML library parses the source and reports syntax or duplicate-key errors. Zod validates structural shape, types, defaults, and unknown keys. Semantic validation checks project references and rules such as repository/path validity, database references, entity relations, endpoint ownership, and auth/permission references. The CLI generation path additionally composes generators and runs scaffolding/output steps; `validate` does not currently guarantee every later generator-composition step will succeed.

The target refactor should have a single normalization/resolution boundary shared by validation and generation. It should produce one typed project model, build a generation plan for the fixed stack, render files, and keep filesystem/process/repository side effects in the CLI. Keep the useful parser, diagnostics, schema generation, safe virtual file output, collision detection, and project-specific validation. Remove framework/ORM/plugin compatibility negotiation that exists only to support arbitrary combinations.

## 5. Modular-monolith architecture contract

A modular monolith has separately owned business modules in one deployable backend. It is not a collection of microservices and does not require HTTP calls between modules. A module owns its entities, application operations, and persistence mapping. Another module may use only a typed public application contract explicitly exported by the owner and imported by the consumer.

The YAML/model design must define unique module and entity ownership, exports/imports, valid references, dependency cycles, and diagnostics for private/deep imports. Architecture families govern internal dependency organization within a module; they do not change the module's public application contract. The backend composition root wires module implementations and their declared dependencies. Avoid a runtime plugin registry, generic dependency-injection framework, service locator, network RPC, or event bus.

Internal calls must propagate a trusted actor/context where business authorization needs it. An arbitrary object claiming an admin role is not a trusted identity. HTTP transport checks and business authorization have distinct responsibilities. Do not imply that calls across modules share one atomic transaction unless the implementation explicitly provides that guarantee. These rules must be specified by RF-03 before implementation work depends on them.

## 6. Authentication and authorization

Better Auth handles identity and session lifecycle in the generated backend. `authUI: true` currently adds sign-in/sign-up pages, forms, and account controls in the frontend. It does not make all frontend pages private or add a Next.js server-side page-access gate. An unauthenticated visitor can see public UI and call intentionally public endpoints.

Generated secured backend endpoints validate the Better Auth session. Missing/invalid session yields 401; failed configured authorization yields 403. State-changing authenticated requests also use trusted-origin checks. Backend route policies are not implied by a frontend UI setting.

The current authorization is static role-to-permission checking, not a general PBAC/policy engine. A user has one server-owned role; a route may list accepted roles and required permissions; all listed permissions must be granted and, when both role and permission constraints exist, both checks must pass. The default role is assigned during account creation and cannot be selected by an untrusted sign-up request. The implementation does not supply tenant/ownership rules, arbitrary contextual policy evaluation, multiple concurrent roles, or an administration product for role assignment. Describe this as roles and permissions rather than promising generic policy-based authorization.

Frontend permission helpers may hide or show controls but are not a security boundary. The backend must enforce access on every protected operation. The target module model must preserve a trusted actor/context and ensure direct in-process calls do not bypass business checks.

## 7. Fixed frontend responsibilities

The generated frontend uses Next.js App Router and Tailwind. TanStack Query owns remote/server data caching and synchronization; Zustand owns shared client UI state. Local component/form state remains local. These choices are fixed implementation details, not YAML selectors.

The current frontend contract derives clients, hooks, forms and entity screens from endpoints exposed by connected backends. The target refactor should resolve endpoint input/output and access metadata once and feed the frontend and backend renderers from the same typed contract. It must not create browser actions for operations absent from the declared API.

## 8. Repository layout and implementation approach

The monorepo currently contains `packages/core` and `packages/cli`; it does not contain a NordixGen web application. Generated client projects are output, not extra generator packages. Current package layout and implementation plan are described in their package documentation.

The fixed-stack refactor may retain ordinary responsibility boundaries (configuration, resolved model, rendering, files, CLI orchestration) while removing generic plugin interfaces, framework contexts, capability matrices, plugin discovery, parallel technology implementations, and repeated inference across generators. Keep simple functions and explicit types. The goal is maintainability for Nordix's chosen stack, not extensibility to arbitrary technologies.

## 9. Future work and exclusions

Client deployment configuration, cloud provisioning, generated CI/CD, IaC/Terraform, generated local Docker environments, and LLM tooling are not implemented and are not part of the v1.1.0 refactor. They may be considered after the refactor, with separate requirements and issues. Do not describe the repository's own package CI/release workflows as generated CI for client projects. The Hono upstream Cloudflare Workers scaffold is not deployment support.

## 10. Related work

- [v1.1.0 fixed-stack refactor milestone](https://github.com/NordixTech/NordixGen/milestone/2)
- [RF-01: Align documentation with the fixed-stack direction](https://github.com/NordixTech/NordixGen/issues/65)
- [RF-02: Generate business routes only from declared endpoints](https://github.com/NordixTech/NordixGen/issues/63)
- [RF-03: Design YAML v2 for a modular monolith with per-module architectures](https://github.com/NordixTech/NordixGen/issues/64)
- [README](../README.md)
- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Workspace package overview](../packages/README.md)
