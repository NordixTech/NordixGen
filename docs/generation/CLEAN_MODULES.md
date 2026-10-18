# Clean business modules

Each backend now generates one modular monolith with module-owned domain entities/enums, application DTOs/use cases/ports, Drizzle adapters and declared controllers under `src/modules/<name>/`. There is no parallel global business-layer output. Scoped render contexts select resolved ownership; they do not parse or infer ownership from entity names. Used domain enums are local to their module and introduce no private cross-module imports.

Platform identity, authorization, HTTP problems/routes, database client/schema and migration/seed helpers are emitted once under `src/platform/`. The explicit composition creates one business database client and supplies that instance to all module bootstrap factories. One Hono application mounts the declared operations from all modules. Platform composition can import module bootstrap/controller implementations; another business module cannot.

Module `index.ts` is the public application boundary. Until public contract/wiring generation (RF-12), independent Clean modules are supported and declarations with imports/exports fail shared preflight with `MODULE_COMMUNICATION_UNAVAILABLE`. No exported operation is silently replaced with an empty implementation. Hexagonal/Onion and many-to-many still fail explicitly before effects. Persistence aggregation is currently platform-owned; the dedicated persistence change (RF-13) refines per-module schemas and query acceptance.

## Enforced boundaries

The generated `scripts/check-boundaries.mjs` uses the TypeScript syntax tree. `pnpm run check:boundaries` rejects infrastructure/HTTP imports into domain/application, another module's deep private imports, undeclared public dependencies and private exports from a module entry. Errors identify consumer, producer/reference, location and correction. Literal dynamic imports/require are checked too; computed imports must be replaced with static declared contracts. This is an architectural source check, not a runtime sandbox for arbitrary authored code.

The CLI runs it after package installation and before Git/GitHub operations. The maintained tests execute the checker on clean output, then deliberately insert invalid inward/private/undeclared imports and private exports and require failure.

## Evidence and limits

Two independent persisted Clean modules compile with real Hono, Drizzle, Neon and Better Auth dependencies in CI. This found and corrected loss of insert-field types and duplicate foreign-key seed assignments. Existing executable generated-handler checks now use module paths, including a two-module request fixture; implicit CRUD remains absent. CLI checks verify one backend scaffold, both modules and the executable boundary command.

Application/public contract communication and generated trusted context are the next dedicated integration. A shared process/client does not imply a shared transaction or automatic business calls. Complete live database/browser acceptance remains later milestone work.
