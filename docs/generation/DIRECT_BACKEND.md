# Direct backend generation

The backend registry, plugin descriptors, selections and capability negotiation have been removed. `generateBackend(project, backendName)` consumes the shared resolved project and returns an in-memory VFS, scaffold command and centrally maintained runtime/development dependencies. It never starts commands or writes files.

The integrated scope supports multiple Clean, Hexagonal and Onion modules per backend. See [module layout and boundaries](CLEAN_MODULES.md). [Public module communication](PUBLIC_MODULES.md) is integrated with typed contracts, explicit wiring and trusted context. All three architecture families are executable; many-to-many emission remains an explicit readiness error. `validate` and `generate` use that same boundary. Mixed-family compiler, HTTP and database tests verify all three families. The integrated Clean commerce example additionally verifies the connected browser product.

Focused domain, application, Hono, Drizzle, identity and authorization renderers are direct typed functions. One Hono renderer owns route/bootstrap aggregation, and one Drizzle renderer owns the current schema aggregation. The collector rejects unsafe paths, escapes and case-insensitive duplicate normalized paths, even equal content, naming both producers. Different full paths with the same basename are valid. There is no file merging or last-writer-wins.

Application and persistence operations are generated exclusively from declared endpoints. Each resolved operation owns one use case, input/output contract, outbound query port and Drizzle adapter. Entity declarations still produce domain state and database schemas, but never implicit create/get/list/update/delete use cases, generic CRUD repository ports/adapters or entity-wide create/update DTOs. Shared response schemas are generated only for entities referenced by operation responses and joins. Clock ports/adapters are emitted only when a declared operation needs dynamic defaults. An entity without endpoints can therefore participate in persisted relations and seeds without acquiring application actions.

The CLI prepares all outputs first, requires a new/empty destination, rejects symbolic-link paths, invokes pinned upstream scaffolds using an injectable runner and installs dependencies in each completed repository workspace. Known initial Hono `src/index.ts` and `wrangler.jsonc` overlays are explicit. Known Next.js layout/page/styles overlays remain part of its existing integration. Other scaffold collisions fail; existing user projects are never regeneration targets. Wrangler receives the fixed node compatibility flag. Configured Git/GitHub actions happen after local generation.

Backend versions have one source in `generation/dependencies.ts`; Drizzle Kit, Faker, TypeScript/Node types and tsx are development tooling. Drizzle ORM 0.45.4 and Kit 0.31.11 align the former ranges with Better Auth's required peers. No new YAML technology selectors are introduced. The library's optional better-call/Zod peer warning does not prevent the tested credential/session paths; generated application schemas still use Zod 3.

## Evidence

Generated Neon HTTP clients reuse their stateless client and Drizzle schema setup within a Worker isolate. The cache holds one configuration, keyed by the complete connection string and local proxy setting; changing credentials, database or proxy rebuilds it. It does not cache SQL results, sessions, IAM grants, request headers or execution contexts, and does not retain a WebSocket connection or transaction. Session and permission checks still execute for each operation. This avoids repeatedly preparing the same schema in authentication, IAM and business adapters; it does not guarantee that the full application fits the Workers Free CPU budget.

The functional tests execute generated Hono handlers, compile application/client contracts, assert single ownership/containment and central dependency categories, compare common readiness and exercise CLI output with an injected command runner. Retired backend registration/capability tests and malformed plugin-context checks were removed with their production APIs. Coverage gates are unchanged.

Focused checks compile backend output with and without configured identity options and verify safe malformed-registration handling. The maintained commerce example supplies separate persisted HTTP and browser evidence. Optional provider configuration does not imply complete provider enrollment, recovery or administration screens.

[Frontend generation](DIRECT_FRONTEND.md) now also uses direct typed functions without registration. The multi-module layout, public application wiring and module-owned persistence each retain their own implementation boundaries.

Internal acceptance checks verify fresh CLI generation, compilation, PostgreSQL persistence, authorization and browser behavior. Run `pnpm test:acceptance`; isolated run artifacts are written under ignored `tmp/acceptance/commerce/`.

## Architecture contracts

The fixed stack, operation semantics and public module API do not vary with architecture. The finite layout resolver selects paths for shared entity, DTO, use-case, clock, SQL and HTTP generators; there is no renderer registry or duplicated backend pipeline.

- **Clean:** domain entities, application use cases/outbound ports, infrastructure adapters and presentation controllers retain their existing paths and behavior.
- **Hexagonal:** `core/domain` holds state and `core/application` holds operations and explicit inbound/outbound ports. Driving `adapters/inbound/http` controllers depend on inbound interfaces, implemented by application operations; driven `adapters/outbound` persistence/clock adapters implement the outbound interfaces. Driving adapters cannot import driven adapters.
- **Onion:** the independent `domain` is the center. `application/services` implements application contracts in `application/contracts` and depends on application-owned persistence/clock ports. Outer `infrastructure/http` controllers invoke those contracts; infrastructure provides concrete implementations. Domain cannot depend on the application ring or any outer ring.

Hexagonal and Onion inbound contracts describe `execute` using application response values and a separate optional operation context. The existing public wrappers enforce trusted context and policies, preserve application results and receive the same explicitly constructed services. No new business workflow or domain service is invented from entity declarations.

Module bootstraps, schema aggregation and module-scoped database types use the selected architecture paths. Identity, database connection, migrations, HTTP policy and public wiring each retain one backend owner. The generated AST checker uses each module's actual domain/application roots, rejects inward infrastructure imports (including type-only and literal dynamic imports), domain-to-application dependencies, cross-module private imports and public re-exports of private code.

`architecture-modules.test.ts` compiles mixed families and exercises deliberate boundary violations. `module-public.test.ts` executes cross-family calls and security/failure cases. `persistence-integration.test.ts` additionally generates/applies migrations and exercises real PostgreSQL reads/writes, validation, defaults, joined pagination and soft deletion for each family alongside Clean. Local persistence tests require the explicit isolated database opt-in described in [Clean modules](CLEAN_MODULES.md).

Authentication migrations also install the invoker-rights public.nordix_consume_limits PostgreSQL function. Run the generated db:migrate command before deploying updated authentication code. It consumes ordered, locked abuse counters in one database statement; if any rule blocks an attempt, every counter change rolls back. IAM access changes keep their advisory transaction lock, current actor checks, state-bound confirmations and last-administrator protection.

Generated frontends can hydrate the first entity list from server reads with cache: no-store. Every render creates a separate query cache, private query keys include user and role, and the backend verifies authorization again for the actual data read. Browser query freshness is ten seconds; mutations still invalidate affected queries. Server identity is a presentation seed until Better Auth settles, never a replacement for backend authorization or a fallback after sign-out. Identity outages show a retryable service error rather than an invented permission denial.
