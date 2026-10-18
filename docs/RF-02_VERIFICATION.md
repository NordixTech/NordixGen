# RF-02 project review and verification

Reviewed on 2026-10-17 (America/Lima), against the product documentation merged by [PR #66](https://github.com/NordixTech/NordixGen/pull/66), the [v1.1.0 milestone](https://github.com/NordixTech/NordixGen/milestone/2), and its 16 issues. RF-01 is closed; RF-02 and the remaining implementation/design issues were open during review.

## Current project and workflow

NordixGen is a pnpm workspace containing `packages/core` and `packages/cli`. There is no generator web application. Node.js 24 and pnpm 10 are required. Generated applications are ordinary independent projects.

Core parses YAML with `yaml`, checks its strict Zod structure, runs semantic/compatibility validation, normalizes fields, relationships and pagination, and renders into a virtual filesystem. The current intermediate representation is format version 3. Backend and frontend composers still use plugin registries and capability negotiation. The CLI owns prompts, upstream scaffolding, file emission, dependency installation, workspace/repository placement and optional configured GitHub publication.

The current backend uses global Clean layers, Hono, Drizzle/Neon, Better Auth and static role/permission policies. There is no implemented business-module ownership or public intermodule contract system. The schema's backend-level `modular` value has no registered generator. The frontend currently retains library/style alternatives and an `authUI` option that adds authentication UI without protecting pages. Validation does not yet share the generator's complete readiness checks.

PR #66 changed the root README and specification and deleted the old implementation plan. It intentionally left the package READMEs unchanged. Their generic-plugin descriptions therefore remain legacy implementation documentation; they do not establish the final fixed-stack product contract.

Normal development checks are:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Build core before CLI integration tests: the CLI resolves core's built package exports. CI targets `develop`/`main`, runs lint/typecheck/build/tests, and releases from `main`. Keep changes focused, use injected process dependencies in CLI tests, and generate into new/empty destinations. Existing local planning documents and ignored examples are not implicitly part of a change.

## Milestone sequence and boundaries

| Work | Issues | Purpose |
| --- | --- | --- |
| RF-01 | #65, PR #66 | Product documentation direction; merged |
| RF-02 | #63 | Explicit business HTTP exposure; this change |
| RF-03–RF-05 | #64, #67, #68 | Normative YAML v2 design, actionable validation, one resolved model/readiness boundary |
| RF-07–RF-09 | #69–#71 | Direct backend/frontend generation and working Clean business modules |
| RF-12–RF-14 | #72, #75, #76 | Typed module calls, owned persistence, consolidated identity/access |
| RF-15–RF-17 | #77–#79 | Verified frontend access/session, consistent API/query/screens, public CLI alignment |
| RF-19–RF-20 | #80, #81 | Integrated acceptance, cleanup/documentation, then fresh post-cleanup acceptance |

RF-06 is absorbed only in the limited file/dependency collection scope of RF-07. RF-18 is rejected. Future Hexagonal/Onion implementations (#73/#74) are outside this milestone; Clean is the executable acceptance scope. Deployment, infrastructure, generated CI/CD, Docker and AI features are excluded.

RF-02 works with the current configuration and generator. It does not require waiting for YAML v2 or RF-19. Later issues retain their own compilation and focused functional checks; RF-19 is the full integration gate, not permission to leave intermediate work unverified.

## RF-02 behavior

Only `endpoints` creates business HTTP controllers and route registrations. Entity declarations still produce their domain/application/persistence artifacts, but no automatic collection/item CRUD API. A formerly implicit URL remains usable when deliberately declared, with that declaration's policy.

The route-dependency factory constructs declared endpoint adapters/use cases. It no longer imports or instantiates generic entity CRUD dependencies solely for the retired controllers. Repository/application implementations remain available as internal artifacts. Health and enabled Better Auth handlers remain infrastructure routes.

Declared method/path, operation identity, body/path/query validation, pagination, public access, verified-session requirements, combined role/permission requirements and trusted mutation origins remain intact. Executable checks also exposed Hono's internal router handling errors before the outer entrypoint; the router now installs the same problem-details error handler so adapter failures retain the intended JSON error response.

Frontend contract construction already filters declared connected endpoints. Focused tests confirm that typed clients, hooks, Explorer and screens do not introduce undeclared update/delete operations or routes for private entities. No frontend renderer rewrite was needed.

## Verification evidence

- Core: **162 tests pass**, with **100% statements, branches, functions and lines**.
- CLI: **14 tests pass**, after rebuilding core. Its auth integration fixture now declares the endpoint it checks and verifies that the former automatic controller/registration is absent.
- Core and CLI production builds and root TypeScript checking pass.
- Executable tests load generated Hono entrypoint, routing, DTOs, application use cases and authorization policy unchanged. Only session verification and persistence boundaries are controlled. They exercise both allowed and rejected requests.
- Former collection and item URLs return **404** for GET/POST/PUT/PATCH/DELETE, including requests carrying a controlled valid session. An entity without endpoints still has domain/repository artifacts.
- Protected requests cover missing/invalid/expired identity (**401**), insufficient permission and independently insufficient role (**403**), trusted-origin rejection, invalid bodies (**400**) and successful authorized execution. Each required permission and role condition remains effective.
- Public queries, UUID validation, bound filters, pagination offset/limit, enabled auth handlers, health and structured adapter errors are exercised.
- A deliberately declared `/sampleitems` POST works with its policy; other undeclared methods/item URLs remain absent. One controller registration executes one authorized operation.
- Fresh output was separately emitted for a small fixture with three declared endpoints and for the same fixture with no endpoints. Using already installed local stack dependencies, full TypeScript checking reported **zero diagnostics** for backend/frontend in both cases: 46/27 source files with endpoints and 31/19 without endpoints. No generated auth or Drizzle implementation was stubbed for these compiler checks.
- Repository lint/import checks pass. Formatting passes for changed TypeScript files. The unmodified Windows checkout contains mixed CRLF/LF endings, causing the default whole-tree formatter check to report existing differences. A separate LF-normalized copy of all 77 source/config files passes the full Biome check, matching a Linux checkout; no unrelated format rewrite was included. `git diff --check` passes.

The focused tests live in `packages/core/tests/declared-routes.test.ts` and run as part of `pnpm test`. Existing Hono, Drizzle, auth and CLI checks were updated to remove expectations of implicit CRUD. The old HTTP test that manually recreated controllers was replaced by tests executing generated modules.

No real database migration, browser login, identity-provider integration, remote deployment or full RF-19 acceptance is claimed. RF-02 intentionally removes undeclared URLs; applications must declare any business operations they need. There is no introduced requirement to wait until a later RF before generating the current supported project shape.
