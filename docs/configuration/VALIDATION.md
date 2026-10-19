# Configuration validation and evidence

The approved [YAML v2 contract](YAML_V2.md) is implemented by the core Zod schema and semantic validators. The three [sample configurations](samples/) pass configuration validation, including the mixed-family example. Acceptance of a configuration does not imply that its project can currently be generated.

## Current generation boundary

`parseNordixYaml(source, filename)` and `validateNordixConfig(input)` check configuration independently of generation readiness. `resolveProjectYaml` and `resolveProject` additionally build the [shared resolved model](RESOLVED_MODEL.md). Both CLI `validate` and `generate` require the same resolution and readiness. Supported generation and failure behavior:

- One or multiple Clean modules per backend generate through the [direct flow](../generation/DIRECT_BACKEND.md), including explicit typed public module calls.
- Hexagonal/Onion report `MODULE_ARCHITECTURE_UNIMPLEMENTED`; no Clean fallback is emitted.
- Many-to-many reports `RELATION_MAPPING_UNIMPLEMENTED`; no partial join table is emitted.
- Syntax, structure, reference and stored-cycle errors precede readiness. Unsupported or invalid input exits with status 1.

For invalid or unsupported input, the CLI creates no output directory and starts no scaffolding, dependency installation, Git command or remote publication. `init` writes a canonical ready starter and refuses overwrites. Supported Clean input uses the direct modular pipeline; no legacy backend-wide path or architecture fallback exists.

## Diagnostic categories

Messages are English, identify a configuration path, explain the failure and provide a corrective action. YAML input additionally supplies source file, line and column at the offending node or nearest existing parent. Object API input provides paths without source coordinates. Parser errors omit source excerpts and raw internal exceptions.

| Contract category | Implemented codes / behavior |
| --- | --- |
| Syntax, duplicate YAML keys | `YAML_SYNTAX_ERROR`, with parser location |
| Unsupported mapping key, merge, tag, excessive alias expansion | `YAML_MAPPING_KEY_INVALID`, `YAML_MERGE_UNSUPPORTED`, `YAML_TAG_UNSUPPORTED`, `YAML_CONVERSION_ERROR` |
| Cyclic or excessive configuration data | `CONFIG_DATA_CYCLE`, `CONFIG_DATA_LIMIT` |
| Version, required/type/unknown/removed fields | `CONFIG_VERSION_UNSUPPORTED`, `CONFIG_FIELD_REQUIRED`, `CONFIG_FIELD_TYPE_INVALID`, `CONFIG_FIELD_UNKNOWN`, `CONFIG_FIELD_REMOVED` |
| Unsupported enum/literal, malformed shape/identifier | `CONFIG_VALUE_UNSUPPORTED`, `CONFIG_FIELD_INVALID`; architecture spelling uses `MODULE_ARCHITECTURE_INVALID` |
| Database ownership | `DATABASE_SHARED_ACROSS_BACKENDS` rejects every colliding `backends[i].persistence.database` reference, names all owners and recommends distinct resources or one modular monolith; unknown resources retain `UNKNOWN_BACKEND_DATABASE` |
| Ownership | `ENTITY_OWNER_MISSING`, `ENTITY_OWNER_DUPLICATE`, `ENTITY_OWNER_BACKEND_MISMATCH`, `UNKNOWN_MODULE_ENTITY` |
| Imports/exports and module graph | `MODULE_IMPORT_UNKNOWN`, `MODULE_IMPORT_NOT_EXPORTED`, `MODULE_IMPORT_SELF`, `MODULE_EXPORT_UNKNOWN`, `MODULE_EXPORT_OWNER_MISMATCH`, `MODULE_DEPENDENCY_CYCLE` |
| Cross-module data access | `CROSS_MODULE_RELATION`, `CROSS_MODULE_JOIN`, `CROSS_MODULE_FIELD_REFERENCE` |
| Generated names, explicit routes and inputs | `GENERATED_NAME_COLLISION`, `DUPLICATE_OPERATION_ID`, `DUPLICATE_ENDPOINT`, `OPERATION_INPUT_COLLISION`, `ENDPOINT_PATH_PARAMETERS_INVALID` |
| Pagination and writes | `UNKNOWN_PAGINATION_PROFILE`, `PAGINATION_PROFILE_INVALID`, `PAGINATION_PARAMETER_CONFLICT`, `MUTATION_GUARD_REQUIRED`, `OPERATION_MAPPING_UNSUPPORTED` |
| Identity and policies | `AUTHENTICATION_REQUIRED`, `ACCESS_POLICY_CONFLICT`, `ENDPOINT_ROLES_REMOVED`, `ROLE_UNKNOWN`, `PERMISSION_UNKNOWN`, `DEFAULT_ROLE_UNKNOWN`, `DEFAULT_ROLE_PRIVILEGED`, plus specific method, grant and persistence errors |
| Frontend authority/pages | `FRONTEND_BACKEND_UNKNOWN`, `FRONTEND_IDENTITY_REQUIRED`, `FRONTEND_IDENTITY_INVALID`, `FRONTEND_IDENTITY_AMBIGUOUS`, `FRONTEND_IDENTITY_MISMATCH`, `FRONTEND_ACCESS_ROUTE_INVALID` |

The reference's `MODULE_PRIVATE_IMPORT`, `MODULE_DEPENDENCY_UNDECLARED` and `ARCHITECTURE_DEPENDENCY_INVALID` concern generated/authored source boundaries, not YAML declarations. Those source checks belong with module generation. Module cycles and stored-foreign-key cycles have separate resolved graphs. `RELATION_CYCLE` identifies an actual stored cycle, including self-cycles, at its source relation; inverse relations and scalar identifiers do not create stored dependencies.

Unused declared databases are allowed. Their resolved database record omits `backend`; used resources record their exclusive backend name. Shared resources fail configuration validation and project resolution before readiness, regardless of `requireGeneration`.

## Executable evidence

Run from the repository root using Node.js 24 and pnpm 10.5.2:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

| Checks | Evidence supplied |
| --- | --- |
| `schema`, `validation`, `entity-validation`, `operation-validation`, `persistence`, `access-validation` | Approved examples; strict selectors/defaults; safe project placement; ownership/import/export/cycle rules; relationship/FK/name conflicts; typed/default values; explicit endpoint mappings, pagination, policies and page access; deterministic multiple failures and no structural cascades; YAML safety and source mapping |
| `json-schema` | Exact equality of generated editor schema and runtime definitions, modules/families present and retired selectors absent |
| CLI initialization/preflight | Starter round trip, prompt cancellation, overwrite protection, invalid input and unavailable generation exit status/messages; no output/runner side effects |
| `resolved-project`, `resolution-contract-cases`, `reference-dictionaries` | Ownership and stable scoped views; deep immutability without mutating caller defaults; concrete fields/defaults, flat inputs, public signatures, policies, projections and separate graphs; canonical serialization; prototype-name references and unknown roles |
| Concrete renderer suites | Executable generated Hono handlers: decoded flat inputs, Date/UTC round trips, explicit nullable response fields, strict query/body guards, malformed JSON and safe errors. Generated application modules and frontend client/types/explorer compile; compiler assertions verify nullable fields and wire dates. Focused tests control external boundaries; separate persistence and commerce checks use real PostgreSQL and browser sessions |
| Documentation/sketch suites | Sample syntax/links, typechecked authored module communication and executable policy propagation sketch; these do not stand in for generated modular integration |

Retired IR, registry/capability and inferred-field assertions have been replaced with diagnostics and valid-model functional checks. Prototype-name references are rejected; undeclared frontend/backend roles fail closed. Internal concrete renderers remain ordinary functions, not selectable library implementations. Checks and CI jobs describe functionality, never issue numbers.

Coverage includes all core source files, including the resolver, without new exclusions. The existing gates remain unchanged: minimum 98% lines/statements/branches and 99% functions. Coverage supports functional evidence; it does not prove every generated-project behavior. The existing CI order remains aligned: lint, typecheck, package build and tests, rebuilding core before CLI integration.

TypeScript rejects unused locals and parameters in core/CLI production code. The documentation suite checks local links across maintained guides and READMEs; the public API suite generates both commerce applications through supported package entry points and rejects leaked renderer extension exports.

The required CI checks run package lint/typecheck/build/tests (including explicitly isolated PostgreSQL persistence tests) and fresh generated-application verification. Run `pnpm example:commerce` with Docker and Chromium available for the latter; see the [commerce guide](../../examples/full-stack-commerce/README.md). Each run records its source revision, working-tree status, environment, stages and behavior results in a new ignored output directory. The cleanup PR records evidence for the final revision, rather than reusing an earlier acceptance run. Optional local persistence-suite skips are not counted as database evidence; the commerce check itself must complete without database/browser skips.
