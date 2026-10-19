# NordixGen product requirements and capabilities

## 1. Purpose

NordixGen is an internal Nordix tool for generating the starting point of client projects from a declarative YAML configuration. It automates repetitive setup and creates a consistent, maintainable application structure using the technology stack Nordix has chosen to support.

The generated application uses TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle ORM, PostgreSQL hosted by Neon, Better Auth, TanStack Query, and Zustand. These are fixed product choices. Project authors configure their application and business model rather than choose among unrelated frameworks, ORMs, database providers, authentication libraries, styling systems, or state libraries.

NordixGen is a generator, not a runtime dependency of the generated application. Generated code belongs to the client project and can be extended as ordinary application code.

## 2. Generated system shape

A project may contain one or more frontend and backend applications, placed in configured repositories and paths. Frontends declare which backends they consume. A backend is a modular monolith: its business modules execute in one process and share the backend's runtime and platform services.

Clean is the implemented module architecture. Hexagonal and Onion are recognized future families and fail generation readiness until their renderers are implemented. The selected family defines dependency direction and the organization of the module's domain, application operations, and adapters. It does not change the public contract another module uses to call that module.

Modules communicate through explicit, typed application contracts and direct in-process calls. A module publishes only declared application operations. A consuming module names the public operations it imports. Contracts use application-level input/output types and errors; they do not expose Hono request objects, Drizzle tables, repositories, or private domain types. The backend composition root wires module implementations together. Internal communication is not an HTTP call to the same backend and does not imply a generic event bus or distributed transaction system.

## 3. Project configuration requirements

The YAML configuration describes project structure and business requirements. It should support:

- A project name and relevant project metadata.
- Repository definitions and application paths, including colocated and separately located applications where supported.
- Frontend applications and the backend applications each frontend connects to.
- One or more named PostgreSQL database resources hosted by Neon. A backend selects its persistence resource; each backend has one database connection scope in the initial design.
- Backend modular monoliths and their business modules, with an architecture family selected for each module.
- Explicit ownership of each entity and application operation by a backend/module.
- Public application operations exported by a module and the imports required by another module.
- Entity fields, identifiers, defaults, enums, relationships, timestamps, soft-delete configuration, and supported constraints.
- Explicit HTTP endpoint operations with method, path, operation identifier, path/query parameters, request body, response shape, pagination, and access requirements.
- Better Auth configuration needed by a project, such as supported credential or provider settings and authentication features.
- Roles and permission grants needed by application endpoints.

Fixed implementation technologies are implicit and are not selectors in project YAML. In particular, frontend framework and styling, backend HTTP framework, ORM, database engine/provider, authentication implementation, and frontend state libraries are not interchangeable configuration choices. Architecture is the bounded exception: each business module selects Clean, Hexagonal, or Onion from the internally supported set.

The YAML schema must reject unknown values and invalid references with actionable diagnostics. A generated editor schema should be derived from the same canonical configuration definitions so editor assistance agrees with CLI validation.

The [YAML v2 reference](configuration/YAML_V2.md) specifies syntax, defaults, ownership, module contracts and access rules. Runtime validation, editor schema and the [shared resolved project model](configuration/RESOLVED_MODEL.md) implement that contract. Multiple Clean modules generate and pass integrated database/browser verification; see [validation behavior](configuration/VALIDATION.md).

## 4. Parsing, validation, and generation requirements

NordixGen parses YAML and reports syntax errors, including duplicate mapping keys. Structural validation checks types, required fields, allowed values, defaults, identifier formats, and unknown keys. Semantic validation checks relationships between declarations, including repository and path references, database references, frontend/backend connections, entity ownership, field and relation references, endpoint ownership, pagination profiles, and access-policy references.

Validation and generation must use the same resolved project model and support rules. A configuration that passes validation must not later fail simply because generation resolves a different framework, architecture, ORM, or capability combination. Diagnostics should identify the configuration path and explain the invalid or unresolved reference.

The resolved model should normalize names, fields, relations, operation inputs/outputs, pagination, module ownership, module dependencies, and effective access requirements once. Frontend and backend generators should consume the same operation contracts rather than independently infer their meaning from raw YAML.

Generation should be deterministic for the same configuration and generator versions. It should detect unsafe output paths, duplicate file ownership, and conflicting generated files before writing the project. Pure generation logic should be separate from command execution, filesystem effects, package installation, and optional remote repository operations.

NordixGen should use maintained upstream scaffolding tools for Next.js and Hono where practical, then add the configured application structure and generated business code. The generator should report unsupported configurations before side effects.

## 5. Business modules and architecture rules

Every business module owns its business entities, application operations, and persistence mappings. Ownership is explicit and exclusive. Architecture families describe internal dependency organization within that ownership boundary.

The generated module must keep domain and application behavior independent of Hono transport and Drizzle persistence details. HTTP controllers and persistence adapters translate between platform concerns and application contracts. The concrete folder layout may vary by architecture family, but each family's dependency direction must be real and reviewable, not just a naming convention.

Module imports must refer to an operation explicitly exported by the owner. Unknown modules, unknown operations, private operations, undeclared dependencies, duplicate ownership, and forbidden cross-module imports must produce actionable validation errors. Synchronous dependency cycles should be rejected with a useful cycle path unless a later design defines safe cycle semantics.

A module must not read or write another module's private table or repository. Cross-module data needed for a use case is obtained through the owner's public application contract. A foreign identifier may be represented as a scalar value; it does not imply an ORM-level relationship, cross-module join, existence guarantee, or business rule by itself.

An import declaration grants a typed dependency and wiring opportunity. It does not invent business orchestration. For example, importing a customer lookup must not silently cause every invoice operation to call it or impose an unrequested customer-status rule. Such behavior belongs in explicit application logic or in a separately specified mapping feature.

## 6. Database and persistence requirements

PostgreSQL on Neon is the supported database engine/provider combination, and Drizzle is the supported ORM. A project may declare multiple named databases for separate backends or applications. The Golden Path strictly rejects sharing a named database resource across multiple backends. Each persisted backend exclusively owns one dedicated resource; consolidate business modules into one modular monolith or declare separate resources. The initial backend model uses one selected database resource per backend; multiple live database connections inside a single backend and cross-database transactions are outside the initial contract.

The generator should create schemas, repository/query adapters, migrations, and seed support for declared entities and supported relationships. Migrations should be reproducible and include platform-owned authentication tables where needed. Generated queries should honor declared pagination and supported filters, ordering, soft-delete rules, and endpoint projection constraints.

Persistence ownership follows module ownership. A module's tables and adapters are private to that module. Schema aggregation for migration tooling may combine module-owned tables without making their repositories public application contracts. Cross-module SQL joins or direct access to another module's table are not implied by a scalar foreign identifier.

Connection strings and credentials must not be stored in project YAML or generated source. Runtime secrets are supplied through the environment in the eventual application execution/deployment setup.

## 7. HTTP endpoints and frontend API contracts

An entity describes domain data; it does not automatically publish a CRUD API. The `endpoints` declarations are the sole source of business HTTP routes. A module may export an operation for another in-process module without exposing it over HTTP. An HTTP route exists only when a corresponding endpoint is declared. Health checks and Better Auth's handler are explicit platform routes, not implicit business CRUD.

An endpoint declaration defines its HTTP method and path, operation identity, input bindings, request validation, response type, pagination behavior, and effective access requirements. Route paths must be unique within the relevant backend scope. Invalid entity/field bindings, missing inputs, duplicate operation identifiers, and unsupported response mappings must be diagnosed before generation.

For each frontend/backend connection, NordixGen should derive typed clients and operation metadata from the backend's declared endpoints. The frontend may generate TanStack Query hooks, forms, API exploration tools, and entity screens using those contracts. It must not advertise mutations or routes absent from the declared endpoint set. Cache identity should include sufficient backend/module/operation context to avoid collisions.

Transport DTOs are separate from internal domain, persistence, and module-contract types. Serialization rules for dates, nullable values, numeric types, and errors must match actual HTTP behavior.

## 8. Authentication and authorization requirements

Better Auth provides identity, credential handling, sessions, and supported external identity-provider integrations. Authentication UI is a client feature: sign-in/sign-up forms and account controls do not by themselves make application pages private. Frontend access policy must be explicit, with public, authenticated, or mixed access as required by the project. Protected page access must be checked server-side using a validated Better Auth session; merely finding a cookie is not proof of a valid session.

The generated backend validates sessions on protected endpoints. Missing or invalid identity receives an unauthorized response; an authenticated actor without the required grant receives a forbidden response. Public endpoints remain intentionally callable without a session. State-changing authenticated requests validate trusted origins.

Application authorization uses RBAC: permissions in code, roles in the database. Business endpoints declare required permissions; direct role restrictions are deprecated and nonempty endpoint `roles` lists are rejected. The static typed permission registry comes from backend operation capabilities plus built-in IAM permissions. Roles and their grants live in PostgreSQL and can be administered without regenerating or redeploying. A user has one server-owned role; untrusted signup cannot select it. Every required permission must be granted; the system administrator's `*` covers all known capabilities. YAML roles/grants initialize newly created roles only and never overwrite administrator edits. Generated platform IAM endpoints and the protected Next.js administration screen manage roles and user assignments with separate permissions. See [identity and IAM behavior](generation/IDENTITY_ACCESS.md), including first-administrator provisioning and system/default-role protections.

Frontend permission helpers are for presentation only. Every protected operation must enforce authorization in the backend/application layer. Internal module calls do not pass through HTTP middleware, so trusted actor/context must be propagated to application operations that require business authorization. Caller-supplied identity claims must not be treated as verified identity without an explicit trusted boundary.

Authentication and authorization remain distinct: Better Auth verifies identity/session; project roles/permissions govern what that identity may do. The design must identify one authentication authority for a frontend when it connects to multiple backends with authentication.

## 9. Frontend requirements

The generated frontend uses Next.js App Router and Tailwind CSS. It follows a feature-oriented organization for project screens and reusable UI. TanStack Query handles remote server data, caching, loading/error state, and mutation invalidation. Zustand holds shared client-side UI state. Local component and form state remains local rather than being placed in a global store without need.

Generated frontend API types and operations must correspond to the declared backend routes. Forms and entity screens should be produced only when the necessary operations exist. Pagination, search/filter input, empty/loading/error states, and access-aware UI should reflect the backend contract. Frontend access checks improve the user experience but never replace server-side endpoint authorization.

Generated frontends support a per-frontend semantic theme with Light, Dark and System modes. For each mode independently, main colors (primary through border) are all-or-none; omitted main palettes use Nordix defaults. Status colors are independently optional and default individually. Palette configuration is validated with actionable diagnostics and included in the shared resolved model and editor schema. CSS variables and Tailwind v4 tokens drive all generated UI, including IAM administration. A synchronous head initializer applies persisted preferences before body rendering; accessible global controls, a Zustand theme hook, live system changes and cross-tab synchronization provide runtime mode selection. Storage failure falls back to configuration without preventing theme changes. Arbitrary runtime palette editing is outside scope.

## 10. CLI and generated project behavior

The CLI should provide commands to initialize a configuration, validate it, and generate a project. Initialization should produce a valid starter configuration for the fixed stack and let the project author describe application paths, databases, modules, entities, endpoints, and access rules without asking for fixed technology selections.

Generation should create or use configured repositories and paths, run the upstream scaffolding tools, render the project files, and report progress and errors clearly. It should avoid overwriting a non-empty target unexpectedly. Every generated repository must initialize Git on main, commit the generated project and create develop from that commit. GitHub repository creation remains optional; when selected, publish both branches atomically. Optional GitHub repository creation/publishing may use the user's existing authenticated GitHub CLI session and should occur only when explicitly configured or requested.

Generated projects should be ordinary editable applications and should not need NordixGen installed at runtime. A configuration change followed by generation should produce a consistent output for the same generator version. Automatic in-place regeneration over user-modified output is not assumed unless separately specified.

## 11. Deployment and operations capabilities

Local Docker environments are generated capabilities. Each application owns a multi-stage Dockerfile, and each repository owns a root `docker-compose.yml`, `.dockerignore` and `docker:up`, `docker:down`, `docker:logs` scripts. Next.js builds use standalone output, repository-root tracing and a non-root runtime. Hono runs through a local Node adapter, keeping the independent Cloudflare Worker entry point. Backend runner images contain production dependencies and transpiled application code; build/typecheck occur in the builder stage.

Each persisted backend receives its own PostgreSQL 16 Alpine service, persistent volume, database healthcheck and Neon HTTP proxy. The proxy preserves the existing Neon HTTP persistence adapter while connecting to local PostgreSQL. Backend startup applies pending migrations before serving requests and records completion of synthetic seeds once per database. Interrupted/failed seeds stop with an actionable error instead of being silently rerun. IAM role initialization remains idempotent and preserves administrator edits. The CLI prepares initial migration SQL once during generation and includes its journal in the client repository; Docker rebuilds reuse that stable history. No login identities are created by synthetic business seeds.

Compose publishes distinct, overridable frontend host ports. Browser business/auth/IAM requests remain on the frontend origin; the frontend proxy uses private bridge URLs. Backend host ports are disabled unless the optional debug override is selected. Split repositories contain only their owned apps/databases and share a project-named private bridge, whose first backend repository starts before consumers. Generated READMEs document overrides, startup order and data lifecycle. `docker:down` deliberately deletes local volumes; ordinary `docker compose down` preserves them. This local workflow builds application images and does not provide source hot reload.

Generated repositories include Cloudflare staging/production Worker environments, Next.js OpenNext configuration, native build/deploy commands, a standalone guided setup CLI, a manual DEPLOYMENT guide and a Neon PITR DISASTER_RECOVERY guide. The setup assistant configures account destinations, persistent Neon branches, build/runtime secrets and native Git push triggers separately from generation. Optional Cloudflare R2 infrastructure uses generated OpenTofu files and native Workers Builds; see [infrastructure operations](INFRASTRUCTURE.md). Arbitrary hosting changes and off-site database backups remain outside this contract. Local containers remain a local development format.

The use of an upstream Hono scaffold that targets Cloudflare Workers does not itself provide deployment configuration or provision resources. NordixGen's own build/release automation is distinct from generated workflows for client applications.

Cloud frontends communicate with their backends exclusively through named service bindings. Server components call the binding transport directly; browser clients use generated same-origin BFF routes. Backend workers.dev, preview URLs and public routes are disabled. No public HTTP fallback is allowed in the cloud. Direct R2 signed downloads are an explicit exception for file delivery. See [deployment architecture](DEPLOYMENT.md).

## 12. Product quality requirements

- Generated TypeScript should compile using the generated project's declared dependencies.
- YAML diagnostics should point to the relevant configuration path and state how to correct it.
- Module and entity boundaries should be explicit in generated code and validated before output.
- A business operation should have one source contract consumed by its HTTP and frontend adapters.
- Protected operations should enforce access on the server, independent of frontend behavior.
- Generation should avoid path traversal, duplicate file ownership, and silent configuration loss.
- The core should remain deterministic and testable without requiring cloud accounts or remote repository creation.
- The implementation should use direct, typed code for the fixed stack rather than a generic plugin/capability framework.

## 13. Current implementation note

The runtime accepts YAML v2 only: architecture belongs to each explicit business module and technology selectors have been removed. The shared immutable model resolves ownership, public application signatures, effective policy, transport contracts and separate module/entity graphs once. Both CLI commands require the same resolution and readiness checks.

Clean modular generation is implemented. Hexagonal/Onion and many-to-many emission have explicit unsupported-generation diagnostics. Business operations come exclusively from declared endpoints: entities never acquire implicit CRUD use cases, repository adapters, HTTP routes or screens. The maintained commerce example verifies the connected local product after fresh generation. Optional provider enrollment/recovery flows, cloud deployment and automatic transactions remain outside that evidence. See [current evidence and limitations](configuration/VALIDATION.md).
## Refactor decisions retained in the implementation

The separate baseline-preservation proposal was discarded. The former RF-06 planning proposal contributed only small file-ownership/collection checks and backend dependency manifests to the direct pipeline; it did not introduce a planning engine or a separate prerequisite. RF-18 conversion was rejected: previous YAML is diagnosed, not migrated or archived as another supported format. RF-19 established the integrated commerce example; RF-20 repeats that verification after cleanup. Future Hexagonal/Onion work does not block supported Clean generation.
