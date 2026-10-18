# Direct backend generation

The backend registry, plugin descriptors, selections and capability negotiation have been removed. `generateBackend(project, backendName)` consumes the shared resolved project and returns an in-memory VFS, scaffold command and centrally maintained runtime/development dependencies. It never starts commands or writes files.

The integrated scope supports multiple independent Clean modules per backend. See [module layout and boundaries](CLEAN_MODULES.md). [Public module communication](PUBLIC_MODULES.md) is integrated with typed contracts, explicit wiring and trusted context. Hexagonal/Onion and many-to-many emission remain explicit readiness errors. `validate` and `generate` use that same boundary. This partial scope is not full milestone/database/browser acceptance.

Focused domain, application, Hono, Drizzle, identity and authorization renderers are direct typed functions. One Hono renderer owns route/bootstrap aggregation, and one Drizzle renderer owns the current schema aggregation. The collector rejects unsafe paths, escapes and case-insensitive duplicate normalized paths, even equal content, naming both producers. Different full paths with the same basename are valid. There is no file merging or last-writer-wins.

Application and persistence operations are generated exclusively from declared endpoints. Each resolved operation owns one use case, input/output contract, outbound query port and Drizzle adapter. Entity declarations still produce domain state and database schemas, but never implicit create/get/list/update/delete use cases, generic CRUD repository ports/adapters or entity-wide create/update DTOs. Shared response schemas are generated only for entities referenced by operation responses and joins. Clock ports/adapters are emitted only when a declared operation needs dynamic defaults. An entity without endpoints can therefore participate in persisted relations and seeds without acquiring application actions.

The CLI prepares all outputs first, requires a new/empty destination, rejects symbolic-link paths, invokes pinned upstream scaffolds using an injectable runner and installs dependencies in each completed repository workspace. Known initial Hono `src/index.ts` and `wrangler.jsonc` overlays are explicit. Known Next.js layout/page/styles overlays remain part of its existing integration. Other scaffold collisions fail; existing user projects are never regeneration targets. Wrangler receives the fixed node compatibility flag. Configured Git/GitHub actions happen after local generation.

Backend versions have one source in `generation/dependencies.ts`; Drizzle Kit, Faker, TypeScript/Node types and tsx are development tooling. Drizzle ORM 0.45.4 and Kit 0.31.11 align the former ranges with Better Auth's required peers. No new YAML technology selectors are introduced. The library's optional better-call/Zod peer warning does not prevent the tested credential/session paths; generated application schemas still use Zod 3.

## Evidence

The functional tests execute generated Hono handlers, compile application/client contracts, assert single ownership/containment and central dependency categories, compare common readiness and exercise CLI output with an injected command runner. Retired backend registration/capability tests and malformed plugin-context checks were removed with their production APIs. Coverage gates are unchanged.

A separately generated single-module persisted backend installs real dependencies and passes strict TypeScript checking, with and without all configured identity options. Real Better Auth also verifies the no-cookie session and rejects malformed registration without a database call. These checks do not claim successful database migrations, persisted HTTP acceptance or browser journeys. See the later persistence/access verification and [CLI workflow](CLI_WORKFLOW.md) for integrated evidence; full milestone acceptance remains separate work.

[Frontend generation](DIRECT_FRONTEND.md) now also uses direct typed functions without registration. The multi-module layout, public application wiring and module-owned persistence each retain their own implementation boundaries.
