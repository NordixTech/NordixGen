# YAML v2: fixed-stack modular project contract

Status: approved contract from [#64](https://github.com/NordixTech/NordixGen/issues/64), implemented for configuration parsing and validation in [#67](https://github.com/NordixTech/NordixGen/issues/67). The runtime and generated editor schema accept YAML v2 only. **Clean modular generation and public application calls are implemented.** Unimplemented architecture families remain explicit readiness failures; live database/browser verification runs through the maintained commerce example. The [shared resolved model](RESOLVED_MODEL.md) is implemented by the core resolution API. See [validation behavior and evidence](VALIDATION.md).

The product requirements remain in [the specification](../SPECIFICATION.md). This contract makes configuration decisions concrete. MUST, MUST NOT and REQUIRED describe normative behavior after implementation. Paths, TypeScript symbol names and directory names explicitly marked illustrative may change without changing that behavior.

## 1. Decisions and scope

1. `schemaVersion: 2` is required; project `version` remains separate.
2. Only plural `repositories`, `backends` and `frontends` declarations exist. Technologies are implicit: TypeScript, Next.js App Router, Tailwind, Hono, Drizzle, PostgreSQL/Neon, Better Auth, TanStack Query and Zustand.
3. Every backend has explicit business modules. A module selects `clean`, `hexagonal` or `onion`; there is no backend-wide architecture or implicit default module.
4. Entity names are project-global. A module's `entities` list is the sole module-ownership declaration. `entities.<Name>.backend` identifies the backend; there is no second `module` field on an entity or endpoint.
5. Each endpoint requires an `operationId`, unique within its backend. Its entity determines the owning module. Only declared endpoints create business HTTP routes.
6. Initially, a module export references an operation underlying one of its declared endpoints. Imports reference a producer module and its exported operation IDs. This deliberately bounded design adds no workflow/operation programming language.
7. A module import supplies a typed dependency. It never invents a business call, SQL join, existence check or transaction.
8. Backend authentication is disabled when `authentication` is omitted. When enabled, operations require authentication by default; an explicit `authRequired: false` permits public access only without role/permission requirements.
9. Frontend access defaults to `public`, independently of API policies. Protected pages validate the selected backend's session server-side; Better Auth is the one reactive session source.
10. Modules call application contracts directly in one process. Domain/application code cannot import Hono or Drizzle. Shared platform integration has one owner per backend.

Clean is the executable architecture target for v1.1.0. Hexagonal/Onion are specified names and boundary contracts for later implementations, not prerequisites to complete that milestone. A structurally/semantically valid mixed-family example is **not generation-ready** until its renderers exist. Public `validate` and `generate` MUST share readiness diagnostics and reject an unimplemented family before side effects.

No v1 converter, second generation engine, in-place regeneration, arbitrary non-Cloudflare IaC, AI, event bus, distributed transaction or arbitrary plugin system is specified. Local Docker and native Cloudflare CI/CD are generated operational capabilities; see the CLI workflow.

### The initial export limitation

An export never creates an endpoint. However, the initial YAML can only name existing endpoint-backed operations as export sources. It cannot declare a YAML-exported internal-only operation without HTTP exposure. Do not add `expose: false`, fake endpoints, implicit entity CRUD or a second operation list to evade that limitation. Authored private application functions remain ordinary client-project code. An eventual internal-only declaration needs its own explicit design. This is narrower than the product's long-term ability to export operations independently of HTTP, and is chosen to keep this first contract implementable.

## 2. Parsing, names and reference scopes

YAML mappings MUST have unique string keys. Merge keys (`<<`), custom tags and cyclic aliases are rejected; ordinary aliases may be expanded before validation. All objects in this document are strict: an unlisted key is an error, including removed selectors. Null is not interchangeable with omission. Arrays marked as sets reject duplicates; they do not silently deduplicate. Defaults apply only to omitted fields.

| Name | Syntax | Scope / references |
| --- | --- | --- |
| Project, repository, organization, app, database, module, role | `^[a-z][a-z0-9-]*$` | Repository/organization/database names unique in their own project collection; app names unique across backends and frontends; modules unique inside their backend; roles inside their backend |
| Entity, field, relation, enum, pagination profile, parameter, body property | `^[A-Za-z][A-Za-z0-9_]*$` | Entities and enums project-global; fields/relations share their entity's member namespace; profiles project-global; parameters/body properties per operation |
| Operation ID | `^[a-z][A-Za-z0-9]*$` | Unique across all modules of one backend, regardless of HTTP method/path; never inferred from a URL |
| Permission | Nonempty string without whitespace | Exact case-sensitive token scoped to one backend; `*` only as an entire role grant |

All references use exact spelling and case. Generated symbols/files/SQL identifiers MUST also be checked for collisions after their actual normalization, including case-insensitive filesystem comparison, reserved TypeScript identifiers and platform auth table names. A normalized-name collision is an actionable configuration error, not automatic renaming. Two local entities both named `Customer` are not supported: use globally distinct names. Modules with the same name in different backends are distinct.

Resolved identities are tuples: `(backend, module)` and `(backend, module, operationId)`. Frontend exports/cache identities include these scopes and inputs. Dotted strings in diagrams are display notation, not extra YAML reference syntax.

## 3. Project, repositories and applications

| Root key | Required / default | Contract |
| --- | --- | --- |
| `schemaVersion` | Required, literal integer `2` | Unsupported/missing version has a specific diagnostic |
| `name` | Required | Project slug |
| `version` | Required | `major.minor.patch` with optional prerelease suffix; preserves the existing project-version syntax |
| `description` | Optional string | Project metadata |
| `organizations` | `[]` | GitHub owner aliases; item fields: required `name`, `handle` (letters/digits/hyphens); no provider selector |
| `repositories` | Required, nonempty array | See repository fields below |
| `databases` | `{}` | Map from database slug to strict empty object `{}`; each is a named PostgreSQL/Neon resource exclusively owned by at most one backend, not a provisioned database |
| `backends` | Required, nonempty array | See backend fields below |
| `frontends` | `[]` | See frontend fields in section 9 |
| `enums` | `{}` | Map to nonempty arrays of unique nonempty string literals |
| `entities` | Required, nonempty map | See section 5 |
| `pagination` | `{}` | Map of profile identifier to section 6 settings |
| `endpoints` | `[]` | Explicit business HTTP operations, section 6 |

| Repository field | Required / default | Contract |
| --- | --- | --- |
| `name`, `path` | Required | Slug and safe path relative to the chosen output directory |
| `organization` | Optional | Existing organization alias |
| `initializeGit` | `true` | Git is mandatory. Omit this field or use `true`; `false` is rejected. Creates initial `main` commit and `develop` from it. |
| `createRemote` | `false` | Explicit opt-in GitHub creation; requires `organization` |
| `visibility` | `private` | `private` or `public`; used only for remote creation |

Repository paths cannot overlap or nest. Application paths are relative to their named repository and cannot overlap or nest within that repository. `.` is valid for one root application with no sibling applications in that repository. Applications in separate repositories may use the same relative path. At least one backend is required in this version; a backend-only project is supported.

Paths MUST use relative POSIX syntax, with no drive/UNC prefix, backslash, NUL, `..`, empty segment, trailing separator, or embedded `.` segment (`.` alone is allowed). Reject Windows reserved device names, trailing dots/spaces and unsafe filesystem characters in generated/configured path segments. Compare resolved paths case-insensitively for portability. Filesystem emission MUST remain inside the intended real target and reject symlink escapes; syntactic checking alone is insufficient. Generation requires a new/empty target; it does not promise atomic rollback after an external tool fails.

| Backend field | Required / default | Contract |
| --- | --- | --- |
| `name`, `repository`, `path` | Required | App slug, existing repository, safe application path |
| `persistence` | Optional | Strict `{ database: <existing database slug> }`; exactly one dedicated resource per persisted backend; sharing across backends is rejected |
| `modules` | Required, nonempty map | Explicit module declarations below |
| `authentication` | Omitted = disabled | Better Auth settings, section 8; `{}` enables defaults |
| `authorization` | Omitted = contextual defaults | Initial database roles/grants, section 8 |

Persistence is optional for deliberately nonpersisted scaffolds. Generation readiness MUST reject a configured database operation that has no persistence implementation, rather than generate a permanently unconfigured HTTP handler. Entities without operations may still have domain artifacts without persistence. Better Auth requires backend persistence. Each persisted backend MUST select a distinct database resource. Sharing any resource across backends is rejected during semantic validation with `DATABASE_SHARED_ACROSS_BACKENDS`, even when their SQL objects would not collide. Consolidate modules into one modular monolith backend or declare a separate resource for each backend. Unused declared resources are allowed and have no `backend` owner in the resolved model. No connection per module or cross-database operation is implied.

| Module field | Required / default | Contract |
| --- | --- | --- |
| `architecture` | Required | `clean`, `hexagonal`, `onion`; no default/fallback |
| `entities` | Required, nonempty unique array | Existing entity names whose `backend` is this backend |
| `exports` | `[]`, unique array | IDs of existing operations owned by this module |
| `imports` | `{}` | Map from another module name in this backend to a nonempty unique array of its exported operation IDs |

Each entity MUST occur exactly once in its backend's module entity lists. Unknown entities, duplicate owners, missing owners, cross-backend ownership, self-imports and unknown producers are rejected. Imports are backend-local; no qualified cross-backend import syntax exists. Empty modules are not supported in this first contract.

## 4. Module graph and architecture boundaries

For each consumer import, create a directed edge `consumer -> producer`. Require an acyclic synchronous graph and report an actual cycle, e.g. `billing -> customers -> billing`. Compose producers before consumers, sorting equally ready module names for stable output. This graph is independent of the entity foreign-key graph; a scalar UUID adds no edge to either graph.

An import is legal only when the producer exports the referenced operation and its owning entity belongs to the producer. Unknown operation, known private operation and operation owned by another module are different failures. Export/import names cannot reference a generated repository method or an implicit entity operation.

One shared backend platform owns identity, policy evaluation, database connection/schema aggregation, HTTP errors and bootstrap. One composition root instantiates modules and injects only their declared public dependencies. Modules must not construct separate identity authorities or discover dependencies dynamically.

| Family | Required inward dependencies | Forbidden dependencies |
| --- | --- | --- |
| Clean | Domain is independent; application use cases depend on domain and application-owned inbound/outbound ports; HTTP/persistence adapters implement those ports; bootstrap chooses implementations | Domain/application -> Hono, Drizzle or concrete adapters; another module's private layers |
| Hexagonal | Application core owns business behavior and input/output ports; driving HTTP adapters invoke input ports; driven persistence adapters implement output ports; composition supplies adapters | Core -> driving/driven adapters, framework request or query-builder objects; adapter-to-adapter business calls |
| Onion | Domain model/services form the center; application services orchestrate inward-facing abstractions; infrastructure/HTTP implement outer adapters; dependencies point toward inner rings | Inner ring -> outer implementation; domain service -> database/transport adapter |

The architecture differences must be reflected in real interfaces/import direction, not only folders. All families implement the same application public-contract convention. Illustrative layout:

```text
src/
  index.ts
  bootstrap/compose-backend.ts
  platform/{auth,authorization,database,http}/
  modules/
    customers/                         # clean
      public/{contracts,index}.ts
      domain/
      application/{use-cases,ports}/
      infrastructure/
      presentation/
    billing/                           # hexagonal, future renderer
      public/{contracts,index}.ts
      core/{domain,application,ports}/
      adapters/{driving,driven}/
    reporting/                         # onion, future renderer
      public/{contracts,index}.ts
      domain/{models,services}/
      application/{services,interfaces}/
      infrastructure/
      presentation/
```

Directory/symbol names above are illustrative. Normative boundaries: consumers import producer types only through its public contracts; application instances receive implementation dependencies by constructor/function injection. Only bootstrap may import multiple modules' composition factories. Shared schema tooling may aggregate private table definitions but those definitions never become consumer dependencies or public re-exports. Focused source/import checks MUST reject deep imports, indirect public re-exports of private repositories/tables, undeclared public dependencies, and dependencies in the wrong direction. An exported `index.ts` alone is not boundary enforcement. Type-only imports are subject to the same privacy rule.

## 5. Entities, fields and data ownership

| Entity field | Required / default | Contract |
| --- | --- | --- |
| `backend` | Required | Existing backend; ownership resolved from its module lists |
| `description` | Optional string | Metadata |
| `fields`, `relations` | `{}` each | Strict named definitions below |
| `timestamps` | `{ createdAt: false, updatedAt: false }` | Only the two listed booleans; enabling either adds its field |
| `softDelete` | `false` | `false`, `boolean`, `timestamp` |

Every entity receives generated `id: uuid`, unique and required. Creation supplies the ID server-side. Enabled timestamps add required date fields: `createdAt` is set on creation; `updatedAt` is set on creation and refreshed by successful updates and soft deletion, using the trusted clock. Boolean soft delete adds required `isDeleted` default `false`; timestamp soft delete adds nullable `deletedAt` default null. Generated field names cannot be redeclared. Generated fields can be referenced by parameters/projections but are server-owned and excluded from ordinary write inputs. Ordinary signup cannot write the platform-owned identity role.

| Field property | Required / default | Contract |
| --- | --- | --- |
| `type` | Required | `string`, `number`, `boolean`, `date`, `uuid`, `json`, `enum` |
| `required` | `true` | Required storage/value vs nullable optional value; input presence rules below |
| `unique` | `false` | One field's database uniqueness; no new compound constraint syntax |
| `description` | Optional string | Metadata |
| `default` | Omitted | Type-compatible literal; date additionally accepts strict `{ kind: now }` |
| `minLength`, `maxLength` | Optional, string only | Nonnegative minimum, positive maximum, min <= max |
| `format` | Optional, number only | `integer`, `float`, `decimal`; omitted is float unless precision requests decimal |
| `precision`, `scale` | Number only | Positive precision, nonnegative scale <= effective precision; decimal defaults 10 and 2; incompatible integer/float precision settings rejected |
| `enumName` | Required for enum only | Existing project-global enum |

Defaults MUST match the type and constraints. Dates use ISO-8601 strings with a timezone, normalized to an instant; dynamic `now` uses an injected trusted clock. UUID literals must be valid UUIDs; numeric defaults must be finite. JSON defaults/values must be JSON-compatible, without undefined/functions/cycles. Optional defaults may be null; required defaults cannot. Enums accept only their declared string values. No SQL expression/default DSL is exposed.

Application values use string/UUID, finite number, boolean, Date and JSON-compatible values. HTTP dates are UTC ISO strings. Decimal values retain the existing JavaScript-number contract, including its precision limits; exact financial decimal arithmetic is not promised. Optional stored values serialize as explicit null when absent; write omission and null remain distinct. Object inputs reject unknown properties.

Create input: exclude generated fields; require a required field without a default; allow omission when a default supplies it; optional omitted fields resolve to their declared default or null. Update input: all writable properties may be omitted, omission preserves stored data, explicit null is allowed only for optional fields, and creation defaults MUST NOT be reapplied. An empty update is invalid. `PUT` uses the same supported partial-update contract as `PATCH`; full replacement is not specified.

| Relation field | Required / default | Contract |
| --- | --- | --- |
| `type`, `target` | Required | `many-to-one`, `one-to-many`, `one-to-one`, `many-to-many`; existing entity in the same module/backend |
| `foreignKey` | Optional | UUID field on owning side; default `<target lowercased>_id` for to-one; for one-to-many, target-side `<source lowercased>_id` |
| `joinTable` | Optional for many-to-many only | Explicit join-table identifier; otherwise `<source snake_case>_<target snake_case>`; reject collisions/ambiguous inverse declarations |
| `onDelete` | `no-action` on owning relations | `cascade`, `set-null`, `restrict`, `no-action`; applies to the stored FK, or both join-table FKs; inverse one-to-many declarations must omit this property |
| `required` | `false` | To-one FK nullability; on collection relations must remain false |
| `description` | Optional string | Metadata |

A to-one relation owns its local FK; one-to-one adds uniqueness. A one-to-many is the inverse of exactly one compatible target-side to-one relation, matching its `foreignKey`; missing/ambiguous inverses are errors. Its delete/nullability behavior comes from that owning relation. Required relations cannot use `set-null`; neither can nonnullable join-table FKs. Many-to-many has no single `foreignKey`; its join table belongs to the same module, with a unique pair of nonnullable FK columns. Recognizing that shape does not authorize a half-generated join table: readiness must reject it until an actual implementation exists. Extra payload on association records requires an explicit entity and to-one relations.

An explicit FK field is allowed only if its type, nullability and uniqueness match the relation-owned field; incompatible declarations are rejected. Seed dependency ordering uses actual stored FKs separately from module order. Unsupported entity dependency cycles fail clearly rather than emitting incomplete seeds/migrations.

Relations, join targets, parameter field references and body field references MUST remain inside the owning module. Endpoints may project/filter a directly related entity through an explicit intra-module join. A UUID in `Invoice.customerId` referring conceptually to Customers is an ordinary scalar: no generated FK, SQL join, module dependency, existence guarantee or automatic call. An intra-module relational filter requires a matching declared direct join; multi-hop/ambiguous relation paths are rejected. Shared enums are immutable project value definitions; each backend schema emits each used enum once, without granting private persistence access.

## 6. Explicit HTTP operations

| Endpoint field | Required / default | Contract |
| --- | --- | --- |
| `backend`, `entity`, `operationId`, `method`, `path` | Required | Existing backend/owned entity, scoped operation ID, `GET`/`POST`/`PUT`/`PATCH`/`DELETE`, absolute route template |
| `summary` | Optional string | Human-readable operation metadata |
| `authRequired` | Omitted = backend inheritance | Boolean override, section 8 |
| `permissions` | `[]`, unique | Static backend-local capability requirements; declarations build the permission registry |
| `roles` | Deprecated; only `[]` accepted | Replace direct business role restrictions with required `permissions` |
| `pathParams`, `queryParams` | `[]` each | Parameters below |
| `requestBody` | Optional | One of the two forms below |
| `pagination` | Optional | Existing project profile name, never an inline second profile syntax |
| `joins` | `[]` | Unique direct related entities in the same module; fields below |

An endpoint's owner is its entity owner. No `module`, `exports`, `operation`, `expose` or response-programming field exists on an endpoint. A private module operation can be exposed through an endpoint without being importable by another module; `exports` means public to permitted modules, not public to HTTP callers.

Paths contain literal URL segments and `{parameterName}` segments. Placeholders must occupy whole segments, be unique and match exactly one required `pathParams` item each. Reject malformed braces, globs, Hono `:param` syntax, query/fragment strings, encoded segments, dot segments, repeated separators and trailing `/` except root `/`. Route literals use letters, digits, `-`, `_`, `.`, `~`. For duplicate detection replace every placeholder with `{}`: `GET /customers/{id}` conflicts with `GET /customers/{customerId}` in one backend. The same pair in different backends is legal. Register static routes before parameterized routes, then by descending static specificity and lexicographic canonical path. Preserve distinct supported HTTP methods; GET also provides normal HEAD behavior, never a mutation. `/health` is reserved for the platform; when authentication is enabled `/api/auth` and descendants are reserved for Better Auth. Infrastructure routes are generated once.

| Parameter field | Required / default | Contract |
| --- | --- | --- |
| `name` | Required | Unique across the operation's path/query/body input names |
| `field` or `type` | Exactly one required | Strict `{ entity, field }` reference, or an explicit supported scalar/JSON/enum type |
| `required` | Query `true`; path literal `true` | References inherit the value type/constraints, not the entity's input default or optionality |
| `enumName` | Required with inline enum type only | Existing enum; not a second override of a field reference |
| `operator` | Field-bound query only; default `eq` | `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte`, `contains` |

Path/query decoding is performed before application invocation. Number: finite numeric text (integer enforced when applicable). Boolean: exactly `true` or `false`. Date: valid timezone-bearing ISO text -> Date. JSON: one valid JSON text value. Other types use decoded strings and their constraints. `in` accepts repeated query keys decoded as a nonempty typed array; other parameters reject repeated keys. `contains` is string-only; comparisons require number/date; equality/inequality support scalar fields; JSON filtering is not supported. Path field bindings use equality. Inline parameters are typed application arguments only, never guessed SQL predicates. Unknown query names are rejected, not silently dropped.

`requestBody` is either a strict map of input properties to field definitions / strict `{ field: { entity, field }, required?: boolean }` references, or strict `{ useCase: { entity, operation: create | update } }`. The reference entity must match the endpoint entity. The `useCase` key is reserved and cannot also be an ordinary inline body property. Field references inherit type/constraints/default; an explicit `required` overrides input presence, without allowing null for a nonnullable stored field. Mutation bodies cannot contain generated fields or arbitrary unmapped writes.

| Method / body | Application behavior | Result |
| --- | --- | --- |
| GET without body | Query entity with supported path/filter/join bindings | Unpaginated rows or page |
| POST + `useCase.operation: create` | Create the endpoint entity using its create input | Array of created rows |
| PUT/PATCH + `useCase.operation: update` | Update matching endpoint entity using partial input | Array of updated rows |
| DELETE without body | Delete matching entity, applying its soft-delete strategy | Array of affected pre-delete rows |
| POST/PUT/PATCH with inline body or no body | Explicitly named custom query/application input; no implicit mutation inferred | Unpaginated rows |

This last case preserves the existing typed-body/custom-query language. Persistence does not silently write arbitrary body properties. New business behavior is explicit authored application code; recognized arguments with no effect in the generated query remain available to that code. Readiness rejects unsupported automatic mappings, rather than guessing a workflow. GET/DELETE bodies, mutation joins, paginated mutations and incompatible method/use-case combinations are rejected.

Update/delete operations require at least one **required** field-bound main-entity equality path/query parameter. At execution the resolved guard must be present; no absent optional filter may turn into an unbounded write. Optional filters may further narrow it. These are explicitly configured bulk-capable matches, not an undocumented guarantee of one affected row. Deletes respect `false` hard delete, `boolean` logical deletion and `timestamp` archival; subsequent generated queries exclude soft-deleted records.

| Pagination profile field | Default | Contract |
| --- | --- | --- |
| `strategy` | `offset` | Only `offset` |
| `pageParam`, `pageSizeParam` | `page`, `pageSize` | Distinct identifier names, not colliding with any operation input |
| `defaultPageSize`, `maxPageSize` | 25, 100 | Positive integers; default <= maximum |

Pagination applies only to GET collection operations without path parameters. Runtime page starts at 1; positive page/page size, size <= maximum; offset = `(page - 1) * pageSize`. Total counts the same filtered active records. Use deterministic ID ascending order unless a later contract adds ordering; no `orderBy` key is introduced here.

Each join is strict `{ entity, type: inner | left, fields: [<existing field names>] }`. `fields` defaults to `[]`, an empty object projection, never all private fields. An inner join excludes main records without matching active related records; a left join retains them. Apply that same existence condition to pagination totals. Scalar/array cardinality follows the resolved direct relation; joins do not duplicate the main row. A response row is `{ entity: <all effective main-entity values>, joins: { <joined entity>: <selected values> } }`. Collection absence is `[]`; an absent left to-one is null. Pagination returns `{ items: <rows>, total, page, pageSize }`; unpaginated operations return a row array, including zero matches as `[]`. Successful operations keep the existing status **200**. No singular-result/204/projection DSL is silently introduced. Application output uses separate application value DTOs, even where its shape resembles HTTP JSON; serializers convert dates/nullability deliberately.

## 7. Public application contracts and composition

Resolve each operation once into its application contract and HTTP binding. Application input is a **flat object** of declared path/query/body property names plus resolved pagination names. It does not accept an HTTP `path`/`query`/`body` wrapper. Duplicate input names across groups are invalid, even if types happen to agree. Body aliases remain explicit input names; resolved field bindings record their domain target. HTTP adapters decode/validate and bind values; internal calls validate the same application types/defaults directly.

An exported signature conceptually has `(input: OperationInput, context: OperationContext) -> Promise<ApplicationResult<OperationOutput>>`. Context is separate from user input. Public output/error types are explicit application value contracts; no inferred `ReturnType` over a private repository/domain class. Public contracts may refer to other public value types, never private ORM/HTTP/domain implementation types.

| Failure | Application meaning | HTTP boundary |
| --- | --- | --- |
| `validation` | Invalid application input; safe field issues | 400 problem details |
| `unauthorized` | Missing/invalid trusted principal | 401 problem details |
| `forbidden` | Trusted principal lacks role/permission/business access | 403 problem details |
| `not_found` | Authored operation explicitly requires an unavailable resource | 404 problem details |
| `conflict` | Known uniqueness/state conflict, safe explanation | 409 problem details |
| `unexpected` | Internal failure, no private exception details | 500 problem details |

Unexpected exceptions are contained at the operation boundary. Their private cause may be logged safely, never returned as SQL/connection details. A normal generated query with no matches returns successful `[]`, not an invented `not_found`. A module propagates another module's application result or explicitly maps it; it must not convert failures to successful empty data by default. No HTTP status code/Response is part of the module API.

The [executable communication sketch](module-communication.ts) demonstrates a Clean Customers public query injected into an authored Hexagonal Billing application method. Its Customer input `{ customerId }` comes from the mixed example's path binding; the returned rows contain public value DTOs. `previewForCustomer` is explicitly authored example code, not generated from `imports` and not an extra YAML-exported operation. The sample uses an injected in-memory port, not the real parser, authentication library or database. Its tests verify the design sketch, not future generated functionality.

Composition order for that example is Customers -> Billing -> Reporting. The root creates one database/identity/policy platform, constructs Customers with its private repository, supplies only `customers.getCustomer` to Billing, and mounts each declared HTTP adapter once. Calling the customer contract does not use Hono or HTTP loopback. The reporting module need not call Billing merely because it exists.

### Trusted context and authorization

The backend establishes a trusted execution context only after real session verification at an HTTP/authenticated server entry. It contains immutable verified principal data (or explicit anonymous state) and is registered/branded by a module-private runtime issuer. TypeScript brands alone are insufficient: operation guards MUST reject arbitrary objects and objects minted by another backend instance. No public constructor, caller-controlled `role`, body `context`, serialized principal or generic `system/admin` bypass is accepted as identity.

Every secured public/application operation checks its own effective policy before executing, including when called from another module. A caller passing its own guard does not satisfy the callee's requirements. Legitimate in-process calls propagate the same trusted context and cannot change principal/role to gain privilege. Public operations can run with a trusted anonymous context. Future explicit background/server principals require a deliberate trusted entry design; this contract does not mint one from YAML or module names.

Transport validation and trusted-origin/CSRF checks stay at the HTTP boundary. Application checks validate business inputs and enforce access. Authored ownership/tenant rules belong in application/domain behavior with trusted context; no tenant/ownership feature is invented here. Contexts are request-scoped, never stored in global mutable identity state or sent to the browser.

### Transactions

One backend database resource is shared, but a direct call does not create an ambient transaction. The current Neon HTTP integration provides independent supported database statements; this contract promises no cross-operation, cross-module or cross-database atomic transaction. If Billing commits a write and Customers then fails, Billing's write remains committed unless explicit application logic handles recovery. A context carries no transaction object. No automatic rollback, saga or outbox is generated. The sketch deliberately performs no writes and cannot establish stronger guarantees.

## 8. Backend identity and operation access

| Authentication field | Required / default | Contract |
| --- | --- | --- |
| `methods` | `[email-password]` | Unique nonempty subset of `email-password`, `username-password`; username requires email-password |
| `identityProviders` | `[]` | Unique subset of `google`, `github` |
| `features` | `[]` | Unique subset of `email-verification`, `password-recovery`, `two-factor` |

No plugin ID or `enabled` alias exists. Omission disables authentication; null/false are invalid. Presence enables the settings. Existing supported Better Auth integration settings are retained, but backend feature generation is not a claim of completed enrollment/recovery/provider UI journeys. Credentials, provider keys, session secrets, trusted origins and connection strings come from runtime environment, never YAML.

Credential registration retains the current open-registration behavior; it cannot accept a user-supplied role. There is no new registration/admin/invitation setting here. The password constraint is one fixed internal shared policy used by backend and frontend; changing its current weak value is owned by backend identity consolidation, not a new YAML selector.

| Authorization field | Required / default | Contract |
| --- | --- | --- |
| `roles` | Required when the object is supplied | Nonempty unique backend role slugs |
| `adminRole` | Required when the object is supplied | A declared role ID that receives `*` automatically and is protected from deletion or permission loss |
| `defaultRole` | Required when the object is supplied | A declared role, deliberately least privilege |
| `rolePermissions` | `{}` | Declared role -> unique list of permission tokens; omitted role grants nothing |

With authentication enabled and authorization omitted, the effective roles are `admin` and `user`, with `adminRole: admin` and `defaultRole: user`. With authentication disabled, authorization must be omitted and effective roles/grants are empty. Concrete operation `permissions` define static capabilities, whether or not any initial role has them. Two built-in capabilities are always registered: `iam:roles:manage` and `iam:users:manage-roles`. Initial role grants must refer to those known capabilities; partial wildcards such as `customers:*` are unsupported. Endpoint `permissions` cannot contain `*`.

`authorization.roles` and `authorization.rolePermissions` initialize PostgreSQL records, not an immutable dictionary. `adminRole` names the declared role that receives `*` automatically; omit it from `rolePermissions`. It is protected from deletion and cannot lose `*`. If its ID already exists, seeding still ensures that critical wildcard grant. `defaultRole` must be a different, least-privilege role. Other roles are initialized atomically: grants are inserted only for a newly inserted role. Existing metadata and grants remain untouched, including permissions removed through administration. Future newly declared roles can be initialized without resetting existing ones. Runtime role IDs need not appear in the original YAML. Use `pnpm auth:create-admin existing@example.com` in the generated backend to promote the first existing account to the configured administrator role after migrations. See [IAM endpoints and administration](../generation/IDENTITY_ACCESS.md).

| Authentication enabled? | `authRequired` | Roles/permissions | Effective result |
| --- | --- | --- | --- |
| No | omitted or false | empty | Public |
| No | true or nonempty requirements | any | Configuration error: identity is unavailable |
| Yes | omitted | empty | Authenticated |
| Yes | true | any | Authenticated plus specified requirements |
| Yes | omitted | nonempty | Authenticated plus specified requirements |
| Yes | false | empty | Intentionally public |
| Yes | false | nonempty | Contradictory access declaration; error, never a public bypass |

This changes the previous omission default (`authRequired` previously defaulted false). Existing public operations must become explicit when a backend enables authentication. Every listed permission must be granted by the account's current database role; business endpoints cannot restrict role names. A single server-owned user role is supported; no arbitrary PBAC/ABAC/multi-role engine. Missing/invalid identity -> 401, insufficient grants -> 403. Secured mutations also require a trusted Origin; origin rejection must not substitute for testing permission checks. Internal calls do not fabricate Origin headers. Platform `/api/auth/*` and `/api/auth/iam/*` are mounted automatically and cannot be business endpoint paths. `/admin/roles` remains protected regardless of the frontend's general page access mode.

The same resolved policy governs HTTP, internal operations, frontend metadata and presentation helpers. Backend application enforcement remains authoritative even when a client hides a button.

### Endpoint audit logging

An endpoint may declare `audit: true` to record its actor, request context, response status and supported before/after data in the backend's unified `audit_logs`. Omitted or false disables business capture. This requires backend persistence (`AUDIT_PERSISTENCE_REQUIRED` otherwise) and does not change access policies. Authentication and successful IAM changes are audited automatically when authentication is configured. Writes are detached from the response with failure isolation. See [audit behavior, limits and administration](../generation/AUDIT_LOGGING.md).

## 9. Frontend access and one identity authority

| Frontend field | Required / default | Contract |
| --- | --- | --- |
| `name`, `repository`, `path` | Required | Shared app-name namespace, existing repository, safe path |
| `connectsTo` | `[]`, unique array | Existing backend slugs; only those HTTP contracts are visible |
| `access` | `{ mode: public }` | Fields below; replaces `authUI`, does not select libraries |

| Access field | Required / default | Contract |
| --- | --- | --- |
| `mode` | `public` | `public`, `authenticated`, `mixed` |
| `backend` | Optional if unambiguous | Authenticated connected backend used as the one identity authority |
| `publicRoutes` | Required nonempty only in mixed mode | Unique public route patterns; forbidden in other modes |

Identity selection: an explicit `backend` must be connected and authentication-enabled. Otherwise, exactly one authenticated connected backend is selected; none means no identity/UI, allowed only for public mode; more than one requires explicit selection (even public mode). Never select the first array member. Public mode can still show sign-in/account controls when an authority is selected. If a connected backend with another authority exposes secured browser operations, reject that frontend connection as unsupported cross-authority access; public operations on other backends are allowed. This does not add cross-backend SSO.

Modes apply to generated frontend pages, not backend routes. Public mode permits page navigation while individual protected API operations still require identity. Authenticated mode protects all business pages including `/` and `/api-explorer`. Mixed mode protects by default and makes only the configured page patterns public. Sign-in and supported sign-up authentication entry pages always remain reachable; user patterns cannot hide them or convert backend API policies.

The generated page inventory is `/` plus one `/<entity-slug>` management page for each entity with frontend-visible declared endpoints; `/api-explorer` exists when any connected endpoint exists. Derive the entity slug by inserting a hyphen between a lowercase letter/digit and a following uppercase letter, then lowercasing (`CustomerAddress` -> `customer-address`); reject resulting slug collisions. A selected identity authority adds `/sign-in` and `/sign-up` as public entry pages. Provider callbacks stay with the backend's Better Auth handler; this contract does not invent extra frontend callback/enrollment pages. Resolve this inventory before validating page access rules.

Route patterns are exact canonical page paths or a trailing `/**` subtree. `/catalog/**` matches `/catalog` and descendants but not `/catalogue`. `/**` is forbidden in mixed mode (use public). Reject `*` elsewhere, dynamic placeholder/glob expressions, query/fragment/encoded/dot segments and patterns outside the generated page inventory. A subtree must match at least one known page. Exact and subtree public matches combine by union; duplicate/redundant overlapping patterns are rejected as configuration mistakes, rather than inventing precedence rules. Generated authentication pages are implicit public exceptions and must not be listed. Authored pages added after initialization require explicit application access handling; this is not a regeneration promise.

For every protected server entry, Next.js forwards only the requesting user's relevant session cookies to the configured authority's known session endpoint, with no shared/public caching. Cookie presence alone, `credentials: include` in a browser and a client-side redirect are not session verification. The boundary must not return private HTML/data before the check. Invalid/expired/revoked identity redirects safely to the local sign-in page; unavailable authority returns a service-unavailable/error response without disclosing protected content or redirecting in a loop. Return destinations must be local canonical page paths.

Supported local verification topology: frontend and backend both use `localhost`, on distinct ports, with one HttpOnly host session cookie visible to requests on that host, compatible cookie path, backend CORS credentials and exact trusted frontend origin. Ports differ; host identity does not. The browser sends cookies and Next.js server forwards them explicitly to the fixed backend URL. Do not mix `localhost`/`127.0.0.1` or assume a backend-only cookie on another host reaches Next.js. Cookie Domain/cross-site production topology is not provisioned here.

Use Better Auth's reactive session state through a thin presentation hook; no Zustand session mirror or localStorage tokens. Zustand stores shared UI only. Queries/private cache must be scoped/cleared across identity changes and protected queries must not run while identity is unresolved. Frontend role/permission helpers are presentation only; server/API checks still apply.

### Frontend design tokens and theme

Each frontend accepts an optional `theme` block. `default` is `system` unless set to `light` or `dark`. Light and dark palettes are independent:

- Omit a mode, or omit all seven main colors in that mode, to use the complete Nordix main palette.
- To customize a main palette, supply **all seven** colors: `primary`, `secondary`, `background`, `surface`, `foreground`, `muted`, `border`. A partial main palette is invalid; it is never mixed with default main colors.
- `error`, `success`, `warning` and `info` are individually optional. Missing status colors always use that mode's defaults, including when the main palette is customized. A mode can contain only status overrides.
- Colors are literal hexadecimal (3/4/6/8 digits), `rgb()/rgba()` or `hsl()/hsla()` strings. RGB supports numeric or percentage channels; HSL hue uses degrees (bare or `deg`), with percentage saturation/lightness. Comma syntax and space/slash syntax, including alpha, are supported. Channels must be in range. Named colors, CSS variables and arbitrary CSS expressions are rejected. Quote hex values in YAML.

```yaml
frontends:
  - name: web
    repository: app
    path: apps/web
    connectsTo: [api]
    theme:
      default: system
      light:
        primary: "#155eef"
        secondary: "#475467"
        background: "#f8fafc"
        surface: "#ffffff"
        foreground: "#101828"
        muted: "#667085"
        border: "#e4e7ec"
        # All status colors omitted: use light defaults.
      dark:
        # All main colors omitted: use the complete dark default palette.
        success: "#75e0a7"
```

Default palettes:

| Token | Light | Dark |
| --- | --- | --- |
| primary | #155eef | #84adff |
| secondary | #475467 | #98a2b3 |
| background | #f8fafc | #0b0f19 |
| surface | #ffffff | #111827 |
| foreground | #101828 | #f9fafb |
| muted | #667085 | #9ca3af |
| border | #e4e7ec | #344054 |
| error | #b42318 | #fda29b |
| success | #067647 | #75e0a7 |
| warning | #93370d | #fec84b |
| info | #175cd3 | #84caff |

The topbar exposes accessible Light/Dark/System buttons. The user's preference is saved as `nordix-theme` in localStorage; an explicit stored preference wins over the configured default. System follows live OS changes. Missing, invalid or unavailable storage falls back to the configured default. Theme preferences are UI state, independent of identity or private query caches. Tokens are fixed at generation time; arbitrary runtime color editing is outside scope. Custom palettes should be checked for text/surface contrast, particularly transparent colors; the generator selects contrasting black/white brand button text and derives status tints, but cannot guarantee arbitrary custom color combinations are accessible.

## 10. Resolved model and diagnostics

One resolver, after syntax/structure validation, produces these concrete views. The names below are illustrative; the information and one-time resolution are normative.

| View | Information resolved once |
| --- | --- |
| Project | Schema/project versions, source locations, repositories, app paths, immutable enum definitions, named database resources |
| Backend | Selected database and platform settings, implemented-family readiness, identity and role grants, owned modules |
| Module | Qualified identity, architecture, entity/operation ownership, public exports, explicit dependency references, dependency order |
| Entity | Effective fields/default/nullability, generated fields, relation FKs/cardinality, private SQL mappings, entity dependency order |
| Operation | Qualified ID, flat application input/output/error types, explicit HTTP bindings and serialization, resolved pagination, supported behavior, effective access |
| Frontend | Connected HTTP operations, transport DTOs, selected identity authority, page inventory/access rules, scoped client/cache names |

Generators receive these views; they do not rerun the YAML parser or independently reconstruct ownership, field defaults, names or policy. Module and entity dependency graphs remain separate. Stable sorting applies only where order has no declared meaning. File collection rejects unsafe/duplicate normalized paths and incompatible dependency versions before emission. Shared bootstrap/schema/providers files have one explicit owner, never last-writer-wins.

Public validation reports syntax, structure, references and readiness in useful English. Each diagnostic has a stable code, severity, configuration path, concrete explanation/correction and source file/line/column when available. Structurally invalid parent data must not cause misleading missing-child cascades. Programmatic input has paths without invented source locations. The categories below are normative; parser implementation may reuse an equivalent existing specific code, but must document that mapping.

| Invalid case | Diagnostic category / example path | Correction |
| --- | --- | --- |
| Missing/unknown version, removed selector, unknown key | `CONFIG_VERSION_UNSUPPORTED`, `CONFIG_FIELD_REMOVED`, `CONFIG_FIELD_UNKNOWN`; `schemaVersion`, `backends[0].framework` | Supply v2/remove obsolete or misspelled key |
| Unknown backend/entity, missing/duplicate module owner | `REFERENCE_UNKNOWN`, `ENTITY_OWNER_MISSING`, `ENTITY_OWNER_DUPLICATE`; `backends[0].modules.billing.entities[0]` | Name both conflicting owners and assign exactly one |
| Invalid or unimplemented family | `MODULE_ARCHITECTURE_INVALID`, `MODULE_ARCHITECTURE_UNIMPLEMENTED`; `backends[0].modules.billing.architecture` | Correct spelling or choose an implemented family; no fallback |
| Unknown producer, private/unknown/foreign operation | `MODULE_IMPORT_UNKNOWN`, `MODULE_IMPORT_NOT_EXPORTED`, `MODULE_EXPORT_UNKNOWN`, `MODULE_EXPORT_OWNER_MISMATCH`; module import/export item | Fix declared public ownership/reference |
| Self dependency or module cycle | `MODULE_IMPORT_SELF`, `MODULE_DEPENDENCY_CYCLE`; module imports | Remove the edge; include actual cycle path |
| Cross-module relation/join/field binding | `CROSS_MODULE_RELATION`, `CROSS_MODULE_JOIN`, `CROSS_MODULE_FIELD_REFERENCE`; offending target/reference | Use a scalar ID and an explicit public application call |
| Private/undeclared/wrong-direction source import | `MODULE_PRIVATE_IMPORT`, `MODULE_DEPENDENCY_UNDECLARED`, `ARCHITECTURE_DEPENDENCY_INVALID`; source file/line | Use the declared public contract; checked in generated project source, not just YAML |
| Duplicate normalized names/HTTP routes/input bindings | `GENERATED_NAME_COLLISION`, `DUPLICATE_ENDPOINT`, `OPERATION_INPUT_COLLISION`; relevant key | Rename or remove the competing declaration; include both locations |
| Unknown profile / unsafe mutation / unsupported mapping | `UNKNOWN_PAGINATION_PROFILE`, `MUTATION_GUARD_REQUIRED`, `OPERATION_MAPPING_UNSUPPORTED`; endpoint property | Correct the explicit supported binding |
| Identity disabled, public+grants, unknown role/permission | `AUTHENTICATION_REQUIRED`, `ACCESS_POLICY_CONFLICT`, `ROLE_UNKNOWN`, `PERMISSION_UNKNOWN`; access property | Enable configured identity or correct access requirements |
| Ambiguous authority / invalid page rule | `FRONTEND_IDENTITY_AMBIGUOUS`, `FRONTEND_IDENTITY_MISMATCH`, `FRONTEND_ACCESS_ROUTE_INVALID`; frontend access | Select one connected authority / an actual supported page |
| Unsafe/overlapping path or output owner | `PATH_UNSAFE`, `APP_PATH_OVERLAP`, `GENERATED_FILE_OWNER_CONFLICT`; configured/output path | Correct containment or internal file ownership |

## 11. Complete examples and intentionally invalid edits

All linked YAML files pass the configuration parser and semantic validator. Public CLI preflight also checks generation readiness and currently exits unsuccessfully for these valid examples:

- [Single Clean module](samples/single-module.yaml): a manually converted backend-only persisted Note query with authentication intentionally disabled.
- [Two Clean modules](samples/clean-modules.yaml): required v1.1.0 architecture scenario with explicit ownership, a public list, protected lookup/create/update/delete, intra-module relations, pagination and a mixed-access frontend. The UUID connecting modules is scalar.
- [Mixed architectures](samples/mixed-modules.yaml): Clean Customers, Hexagonal Billing and Onion Reporting. Valid target ownership/dependencies; not generation-ready until the future renderers exist. Billing's import grants a dependency, not automatic invoice workflow.

The following edits to those files are syntactically valid YAML but semantically invalid. They are fragments to replace/insert at the named location, not standalone project files. Later schema/model tests must assert their diagnostics; this design PR checks syntax, links and the executable contract sketch without implementing a competing v2 validator.

| Starting example and edit | Expected failure |
| --- | --- |
| Mixed: add `Customer` to `backends[0].modules.billing.entities` | Duplicate owner; identify customers and billing |
| Clean: remove Customer from customers' `[Customer, CustomerAddress]` list | Missing owner for `entities.Customer`; the module still has a nonempty list |
| Mixed: replace `billing.imports.customers` by `ghost: [getCustomer]` | Unknown producer at that import key |
| Mixed: remove customers' `exports` while keeping Billing's import | Private operation at `imports.customers[0]` |
| Mixed: export `listInvoices` from customers | Owner mismatch; operation belongs to billing |
| Mixed: export `missingOperation` from customers | Unknown export |
| Mixed: customers imports billing.listInvoices and billing exports it | Cycle `customers -> billing -> customers` |
| Mixed: add Invoice relation below | Cross-module persistence relation |
| Mixed: add join below to `listInvoices` | Cross-module join |
| Mixed: set a customer lookup permission while explicitly `authRequired: false` | Conflicting public/access policy |
| Clean: remove `access.backend` and add an authenticated second backend to frontend connections | Ambiguous identity; do not choose first |
| Clean: change mixed public route to `/missing-page` | Unknown generated page rule |
| Single: duplicate GET `/api/notes` with a different operation ID | Duplicate method/path in the same backend |
| Single: add `framework: hono` on backend | Removed field, not an accepted default selector |

```yaml
# Invalid relation: entities.Invoice.relations.customer
type: many-to-one
target: Customer
foreignKey: customerId
```

```yaml
# Invalid join: endpoints[listInvoices].joins
- entity: Customer
  type: left
  fields: [id, name]
```

```yaml
# Invalid access: endpoints[getCustomer]
authRequired: false
permissions: [customers:read]
```

An authored Billing source file with either import below violates module privacy, even if the database is shared or the import is type-only. A check reports `MODULE_PRIVATE_IMPORT` at that file/line and directs the consumer to its declared `customers.getCustomer` dependency. Re-exporting these private symbols through Customers' public entry is also forbidden.

```ts
// Invalid source edits; illustrative paths, not supported consumer dependencies.
import type { CustomerRepository } from "../../customers/application/ports/customer-repository";
import { customerTable } from "../../customers/infrastructure/customer-table";
```

## 12. Manual transition and check policy

| Previous input | Canonical v2 decision |
| --- | --- |
| No schema marker | Add `schemaVersion: 2`; keep project `version` |
| `frontend`, `backend` | Use named `frontends`, `backends` arrays only |
| Frontend framework/type/styling/ui/stateManagement | Remove; fixed frontend stack and hooks; no alternate library branch |
| Backend framework/architecture | Remove framework; declare explicit module with required architecture |
| `persistence.orm`, database engine/provider | Remove selectors; keep database name/resource reference |
| `authentication.plugin`, `authorization.plugin` | Remove; keep supported project settings |
| `auth.type` and old aliases | Remove; omit `authentication` to disable or use the canonical object to enable |
| `authUI` | Remove; explicit page access mode and selected identity control behavior |
| Optional/fallback operation ID | Supply a unique explicit ID and update export/import references |
| Authenticated backend with omitted public access | Add explicit `authRequired: false` where public access is intended |
| Cross-module ORM relation/join | Replace with scalar field and explicit public application call, without claiming automatic equivalence |
| `organizations[].provider` | Remove; existing remote integration is GitHub |
| Dormant deployment/docker/llm keys | Outside v2; remove, no replacement behavior in this contract |

For a current single-backend Clean input with `Note`, keep the existing fields, database resource, repository placement and declared list endpoint. Remove `framework`, backend `architecture`, `persistence.orm` and database engine/provider; add `schemaVersion: 2`, `modules.notes: { architecture: clean, entities: [Note] }` and explicit `operationId: listNotes`. The complete result is the single-module example. It has no hidden legacy mode and needs no converter.

Checks follow implemented behavior: strict configuration/readiness, resolved ownership, declared operation output, boundaries, persistence, policies, clients, forms and cache isolation. Test and CI names describe functionality rather than issue numbers. Documentation sketches explain contracts; generated-project integration provides separate executable evidence.

Previous schemas and technology selectors are rejected rather than converted. Clean modules use one direct generation pipeline with module-owned persistence, typed public calls and enforced source boundaries. Hexagonal/Onion and many-to-many remain recognized but unimplemented generation cases; no fallback is emitted. The CLI initializes new/empty projects only; it does not update or migrate an edited generated project.

## 13. Verification and implementation status

`packages/core/tests/configuration-documentation.test.ts` parses complete examples and invalid-edit snippets for YAML syntax/duplicate keys, checks local links, and typechecks the public-contract/composition sketch. `packages/core/tests/module-communication-example.test.ts` executes that authored sketch: permitted direct calls, missing/fabricated/expired sessions, independent caller/callee permission denial, forged principal rejection, application-input validation, explicit not-found mapping and safe error propagation. These are documentation/example checks; they are not an implementation of v2 semantic validation or generated module acceptance.

Runtime validation, editor-schema synchronization, the shared resolved model, direct generation, module guards/boundaries and database/browser verification are implemented. See [validation behavior and evidence](VALIDATION.md) and the [commerce example](../../examples/full-stack-commerce/README.md) for current commands, scope and limitations.

## Optional Cloudflare infrastructure

```yaml
iac:
  repository: app # optional owner; defaults to the first repository
  cloudflare:
    r2_storage:
      documents: { visibility: private }
      assets: { visibility: public }
# On a backend:
# iac: { r2_storage: [documents, assets] }
```

Multiple backends may reference the same bucket. Omission creates no infrastructure. Generation emits independent OpenTofu files; subsequent changes are ordinary edits to those generated files, including their storage output associations. This does not change the existing one-shot generation lifecycle. Public buckets require a Cloudflare custom domain and zone per environment. See [infrastructure operations](../INFRASTRUCTURE.md).
