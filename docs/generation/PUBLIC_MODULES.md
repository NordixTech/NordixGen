# Public application contracts and direct calls

Module public entries export explicit input/output value types and only the declared `PublicApi`. Application inputs are flat; `OperationContext` is a separate argument. Outputs use application values (including Date), arrays/pages and declared join projections. Public contracts contain no Hono requests/responses, Drizzle types, private domain classes or repository implementations.

Each consumer gets a generated `ModuleDependencies` with only its declared producer operations. The backend composition constructs modules in resolved dependency order and injects actual producer methods. Calls stay in one process, with ordinary functions/constructors. An import neither adds an HTTP route nor invents a business workflow. The maintained PreviewCustomer fixture is deliberately authored application code using generated dependencies; its lookup/not-found decision is not generated from YAML.

## Trusted context and failure boundary

A backend entry creates an operation boundary whose verifier calls Better Auth. Issued contexts and principal values are frozen; a private WeakSet validates issuance and the context is revoked when the awaited request operation finishes. Public operations require an issued anonymous context; protected operations additionally require verified identity and their resolved role/permission policy. JSON principal objects, changed roles, foreign/unissued objects and expired contexts cannot establish authority.

The same backend role/permission helper is reused by HTTP preflight and application guards. Every generated application entry, including private HTTP operations, enforces its resolved guard. HTTP preflight rejects unauthorized requests before input parsing; the request boundary memoizes the verified Better Auth session so controller and application authorization share one identity lookup. A direct consumer call still enforces the callee policy. HTTP parsing and trusted-origin checks remain transport concerns.

Generated operation wrappers validate through their application use cases, preserve successful empty query arrays and contain unexpected exceptions. Internal APIs return `ApplicationResult<T>` with validation/unauthorized/forbidden/not_found/conflict/unexpected failures, never a Response. Deliberate `ApplicationFailure` messages must be safe; unexpected messages are always replaced. The HTTP bridge maps the six failures to 400/401/403/404/409/500 problem details.

The context carries no transaction or database object. If an authored caller commits an effect before a callee fails, that effect remains committed. There is no ambient rollback, automatic existence validation, distributed transaction, outbox or event bus.

## Evidence

Maintained tests compile generated two-module output and an explicitly authored consumer against real stack libraries. Compiler assertions reject HTTP wrappers as application inputs, private public methods, forged/mutable contexts and string application dates. Executable tests use generated composition, public wrappers, real application schemas and Drizzle schema/query adapters; only the database/session external boundary is controlled.

They cover success, caller-only denial, callee-only denial, wildcard grants, forged/replayed contexts, public anonymous calls, invalid/extra inputs, empty arrays, authored not-found, safe known errors, unexpected SQL-like causes, HTTP mapping and the lack of automatic rollback. Existing generated-project AST checks continue rejecting private/undeclared imports and private reexports. Clean-to-Clean closes this scope; future families can implement the same public API without changing the consumer contract.

The maintained [commerce example](../../examples/full-stack-commerce/README.md) verifies fresh public-CLI generation, application compilation, Worker bundling, real PostgreSQL migrations/seeds, HTTP authorization, browser forms and account-cache isolation. Run `pnpm example:commerce` from the repository root; each run writes revision, environment and stage/behavior results into a new ignored `tmp/examples/full-stack-commerce/<id>/` directory. This verifies the supported local topology, not cloud deployment or every optional identity-provider journey.