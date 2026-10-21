# Shared resolved project model

`resolveProjectYaml(source, filename?, options?)` parses and validates YAML v2 once, then constructs `ResolvedProject` format version 5. `resolveProject(input, options?)` provides the same object API. Failure returns English, actionable path diagnostics; YAML diagnostics include the source node or nearest parent. The raw configuration parser is available separately and does not build renderer models.

## Model and consumers

The model contains project/resources, backend-qualified modules and operations, effective entities/fields/relations, public application contracts, frontend transport contracts and precomputed page/feature metadata. `backendView(project, name)`, `moduleView(project, backendQualifiedModuleId)` and `frontendView(project, name)` select existing resolved data. They never reparse, revalidate or reconstruct configuration. Unknown targets fail explicitly.

Each resolved database records its exclusive owner in optional `backend`. An absent owner marks an unused declared resource. Multiple backends selecting the same resource fail semantic validation before a model can be built; backend database references point to the same resolved resource record.

All data is deeply frozen and typed readonly, including nested defaults and collections. Resolving an object does not mutate or freeze caller-owned defaults. Dictionaries have no inherited keys, so an undeclared reference such as `constructor` is an unknown reference. Serialization sorts object keys, preserves meaningful array order and includes source metadata; identical source/model input produces identical output.

Effective fields include generated identity/audit/soft-delete fields, SQL names, nullability, write visibility and absent/literal/trusted-clock defaults. Numeric fields have resolved numeric formats and decimal precision/scale. Relations carry resolved owning entity, target, foreign key and deletion semantics; scalar identifiers never create module dependencies. Generated fields cannot silently become caller-writable fields.

| Value | Application contract | HTTP/frontend contract |
| --- | --- | --- |
| Date | `Date`; trusted clock or normalized literal instant | Timezone ISO string, serialized UTC |
| Number | Finite number with resolved integer/float/decimal constraints | JSON number; query text decoded and checked |
| Optional stored value | Value or `null` | Required response property containing value or `null` |
| Optional/defaulted input | Independently marked optional and/or nullable | Omission and explicit null remain different |
| Enum | Declared literal union | Same literals |
| JSON | JSON descriptor and JSON-compatible defaults | JSON value; JSON query text decoded |

Path/query/body declarations remain transport bindings. Application inputs are flat named values, without `{ params, query, body }` wrappers. Create defaults, update inputs, generated values and inline argument aliases are resolved separately. Pagination retains its selected profile, effective values and source origin. Consumers receive operation names, access requirements, response cardinality/projections and frontend invalidation/record-ID metadata instead of inferring them from HTTP verbs or route strings. A custom POST does not imply a create screen.

## Public contracts and graphs

Module exports/imports reference application signatures with flat input, output, effective access, trusted backend context and a fixed application-error vocabulary. These signatures contain no private entity/repository objects, SQL mapping or Hono request types. Frontend contracts contain only exposed entities and declared join projections, transport values and page/access metadata. Full related entities are not exposed by an inline projection.

Generated context issuance, callee guards, result handling and architecture-boundary enforcement consume these contracts. Declaring an import allows a typed application dependency; it never creates an automatic workflow, HTTP route, ORM join or transaction.

Module dependencies and stored-foreign-key dependencies have independent graphs and deterministic orders. Only actual owning foreign keys create entity edges; inverse relations and scalar identifiers do not. Stored cycles, including self-cycles, return `RELATION_CYCLE` at the relevant YAML relation rather than a fallback seed/migration order.

## Readiness and direct generation

Both CLI `validate` and `generate` call resolution with `{ requireGeneration: true }`. Invalid configuration or resolution fails before readiness. One or multiple Clean, Hexagonal and Onion modules generate through the [direct backend pipeline](../generation/DIRECT_BACKEND.md). Many-to-many reports `RELATION_MAPPING_UNIMPLEMENTED`. No output, installation or publication starts on those failures.

Backend and frontend generation call concrete typed renderers over resolved views. The internal `plugins/` directory contains those renderers and small path/context types, not a selectable plugin protocol. There is no registry, composer, capability negotiation, planner, legacy normalizer or second authoritative model. Package exports expose configuration, model views, generation and file APIs; concrete renderers remain internal.

The maintained [commerce example](../../examples/full-stack-commerce/README.md) verifies fresh public-CLI generation, application compilation, Worker bundling, real PostgreSQL migrations/seeds, HTTP authorization, browser forms and account-cache isolation. Run `pnpm example:commerce` from the repository root; each run writes revision, environment and stage/behavior results into a new ignored `tmp/examples/full-stack-commerce/<id>/` directory. This verifies the supported local topology, not cloud deployment or every optional identity-provider journey.
Frontend views include a resolved theme: the initial mode and complete independent light/dark palettes. Schema validation enforces all-or-none main palettes before resolution; only omitted palettes and individual status colors receive defaults. Renderers consume these values without reinterpreting raw YAML.
