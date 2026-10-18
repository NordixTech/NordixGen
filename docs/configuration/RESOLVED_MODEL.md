# Shared resolved project model

`resolveProjectYaml(source, filename?, options?)` parses and validates YAML v2 once, then constructs `ResolvedProject` format version 5. `resolveProject(input, options?)` provides the same object API. Failure returns English, actionable path diagnostics; YAML diagnostics include the source node or nearest parent. The raw configuration parser is available separately and does not build renderer models.

## Model and consumers

The model contains project/resources, backend-qualified modules and operations, effective entities/fields/relations, public application contracts, frontend transport contracts and precomputed page/feature metadata. `backendView(project, name)`, `moduleView(project, backendQualifiedModuleId)` and `frontendView(project, name)` select existing resolved data. They never reparse, revalidate or reconstruct configuration. Unknown targets fail explicitly.

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

The descriptors establish the model contract. Generated context issuance, callee guards, result handling and architecture-boundary enforcement still require their dedicated integrations. Declaring an import allows a typed application dependency; it never creates an automatic workflow, HTTP route, ORM join or transaction.

Module dependencies and stored-foreign-key dependencies have independent graphs and deterministic orders. Only actual owning foreign keys create entity edges; inverse relations and scalar identifiers do not. Stored cycles, including self-cycles, return `RELATION_CYCLE` at the relevant YAML relation rather than a fallback seed/migration order.

## Readiness and temporary adapters

Both CLI `validate` and `generate` call resolution with `{ requireGeneration: true }`. Invalid configuration or resolution fails before readiness. Single Clean modules are integrated through [direct backend generation](../generation/DIRECT_BACKEND.md). Multiple Clean modules still report `MODULE_GENERATION_UNAVAILABLE`; Hexagonal/Onion report `MODULE_ARCHITECTURE_UNIMPLEMENTED`. Many-to-many relations additionally report `RELATION_MAPPING_UNIMPLEMENTED`: no partial join table is generated. No output, installation or publication starts on these failures.

The old IR and configuration normalizers have been removed. Existing renderer internals consume resolved views through temporary fixed adapters. Backend/plugin composition is removed by the direct pipeline work (RF-07), frontend renderer settings by RF-08 and the backend-wide layout by Clean module generation (RF-09). There is no new plugin protocol, planner or second authoritative model.

Generation remains unavailable until those integrations and executable acceptance pass. Focused generated-handler execution and application/client compilation are current evidence; they do not claim a real database or browser run. See [validation and evidence](VALIDATION.md).
