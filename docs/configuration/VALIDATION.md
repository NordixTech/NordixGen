# Configuration validation and evidence

The approved [YAML v2 contract](YAML_V2.md) is implemented by the core Zod schema and semantic validators. The three [sample configurations](samples/) pass configuration validation, including the mixed-family example. Acceptance of a configuration does not imply that its project can currently be generated.

## Current generation boundary

`parseNordixYaml(source, filename)` and `validateNordixConfig(input)` check configuration independently of generation readiness. `resolveProjectYaml` and `resolveProject` additionally build the [shared resolved model](RESOLVED_MODEL.md). Both CLI `validate` and `generate` require the same resolution and readiness. They currently exit 1 for otherwise valid configurations:

- Clean modules report `MODULE_GENERATION_UNAVAILABLE` because modular emission is not integrated.
- Hexagonal/Onion report `MODULE_ARCHITECTURE_UNIMPLEMENTED`; they never fall back to Clean.
- Invalid syntax, structure, references or stored foreign-key cycles report their own errors before readiness, avoiding derivative failures.
- Many-to-many mappings report `RELATION_MAPPING_UNIMPLEMENTED`; no partial join table is emitted.

The CLI never invokes the old global-layer generator for a modular configuration. It creates no output directory and starts no scaffold, dependency installation, Git command or remote publication. `init` still writes a valid canonical starter configuration and refuses overwrites. The resolved model is implemented. Restoring generation requires the direct pipeline (RF-07) and Clean modules (RF-09), followed by executable integration acceptance. This work does not establish database/browser acceptance or support all three architecture generators.

## Diagnostic categories

Messages are English, identify a configuration path, explain the failure and provide a corrective action. YAML input additionally supplies source file, line and column at the offending node or nearest existing parent. Object API input provides paths without source coordinates. Parser errors omit source excerpts and raw internal exceptions.

| Contract category | Implemented codes / behavior |
| --- | --- |
| Syntax, duplicate YAML keys | `YAML_SYNTAX_ERROR`, with parser location |
| Unsupported mapping key, merge, tag, excessive alias expansion | `YAML_MAPPING_KEY_INVALID`, `YAML_MERGE_UNSUPPORTED`, `YAML_TAG_UNSUPPORTED`, `YAML_CONVERSION_ERROR` |
| Cyclic or excessive configuration data | `CONFIG_DATA_CYCLE`, `CONFIG_DATA_LIMIT` |
| Version, required/type/unknown/removed fields | `CONFIG_VERSION_UNSUPPORTED`, `CONFIG_FIELD_REQUIRED`, `CONFIG_FIELD_TYPE_INVALID`, `CONFIG_FIELD_UNKNOWN`, `CONFIG_FIELD_REMOVED` |
| Unsupported enum/literal, malformed shape/identifier | `CONFIG_VALUE_UNSUPPORTED`, `CONFIG_FIELD_INVALID`; architecture spelling uses `MODULE_ARCHITECTURE_INVALID` |
| Ownership | `ENTITY_OWNER_MISSING`, `ENTITY_OWNER_DUPLICATE`, `ENTITY_OWNER_BACKEND_MISMATCH`, `UNKNOWN_MODULE_ENTITY` |
| Imports/exports and module graph | `MODULE_IMPORT_UNKNOWN`, `MODULE_IMPORT_NOT_EXPORTED`, `MODULE_IMPORT_SELF`, `MODULE_EXPORT_UNKNOWN`, `MODULE_EXPORT_OWNER_MISMATCH`, `MODULE_DEPENDENCY_CYCLE` |
| Cross-module data access | `CROSS_MODULE_RELATION`, `CROSS_MODULE_JOIN`, `CROSS_MODULE_FIELD_REFERENCE` |
| Generated names, explicit routes and inputs | `GENERATED_NAME_COLLISION`, `DUPLICATE_OPERATION_ID`, `DUPLICATE_ENDPOINT`, `OPERATION_INPUT_COLLISION`, `ENDPOINT_PATH_PARAMETERS_INVALID` |
| Pagination and writes | `UNKNOWN_PAGINATION_PROFILE`, `PAGINATION_PROFILE_INVALID`, `PAGINATION_PARAMETER_CONFLICT`, `MUTATION_GUARD_REQUIRED`, `OPERATION_MAPPING_UNSUPPORTED` |
| Identity and policies | `AUTHENTICATION_REQUIRED`, `ACCESS_POLICY_CONFLICT`, `ROLE_UNKNOWN`, `PERMISSION_UNKNOWN`, `DEFAULT_ROLE_UNKNOWN`, plus specific method, grant and persistence errors |
| Frontend authority/pages | `FRONTEND_BACKEND_UNKNOWN`, `FRONTEND_IDENTITY_REQUIRED`, `FRONTEND_IDENTITY_INVALID`, `FRONTEND_IDENTITY_AMBIGUOUS`, `FRONTEND_IDENTITY_MISMATCH`, `FRONTEND_ACCESS_ROUTE_INVALID` |

The reference's `MODULE_PRIVATE_IMPORT`, `MODULE_DEPENDENCY_UNDECLARED` and `ARCHITECTURE_DEPENDENCY_INVALID` concern generated/authored source boundaries, not YAML declarations. Those source checks belong with module generation. Module cycles and stored-foreign-key cycles have separate resolved graphs. `RELATION_CYCLE` identifies an actual stored cycle, including self-cycles, at its source relation; inverse relations and scalar identifiers do not create stored dependencies.

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
| Concrete renderer suites | Executable generated Hono handlers: decoded flat inputs, Date/UTC round trips, explicit nullable response fields, strict query/body guards, malformed JSON and safe errors. Generated application modules and frontend client/types/explorer compile; compiler assertions verify nullable fields and wire dates. Persistence/session boundaries and external UI dependencies use test stubs; no real DB/browser claim |
| Documentation/sketch suites | Sample syntax/links, typechecked authored module communication and executable policy propagation sketch; these do not stand in for generated modular integration |

The old IR tests, sparse/invalid renderer-model tests and retired field/name inference were replaced with resolution diagnostics and valid-model functional checks. Unknown enum/entity/module/field/profile references cannot resolve to inherited JavaScript properties; generated backend/frontend role lookups deny undeclared prototype names. Fixed renderer adapters still have focused output checks until the production paths are replaced. Remaining alternate-library template checks belong to still-existing frontend internals and retire with their replacement, not to YAML selectors. Checks and CI jobs describe functionality, never issue numbers.

Coverage includes all core source files, including the resolver, without new exclusions. The existing gates remain unchanged: minimum 98% lines/statements/branches and 99% functions. Coverage supports functional evidence; it does not prove every generated-project behavior. The existing CI order remains aligned: lint, typecheck, package build and tests, rebuilding core before CLI integration.

Local verification on Node.js 24.21.0: 333 core tests across 24 suites and 17 CLI tests across two suites pass. Core coverage is 99.74% lines/statements, 98.11% branches and 100% functions, above the unchanged gates. Both package builds, root TypeScript checking and full Biome formatting/lint/import checks pass (the full formatting check uses an LF-normalized source/config copy to match Linux without changing unrelated Windows files). Six built-CLI invocations compare both commands on all three samples: identical readiness codes, exit 1 and no output. The pull request records CI for the pushed commit. See the [model guide](RESOLVED_MODEL.md) for the explicit adapter retirement boundaries and remaining integration work.
