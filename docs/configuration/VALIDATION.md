# Configuration validation and evidence

The approved [YAML v2 contract](YAML_V2.md) is implemented by the core Zod schema and semantic validators. The three [sample configurations](samples/) pass configuration validation, including the mixed-family example. Acceptance of a configuration does not imply that its project can currently be generated.

## Current generation boundary

`parseNordixYaml(source, filename)` and `validateNordixConfig(input)` check configuration independently of generation readiness. Both CLI `validate` and `generate` additionally require readiness. They currently exit 1 for otherwise valid configurations:

- Clean modules report `MODULE_GENERATION_UNAVAILABLE` because modular emission is not integrated.
- Hexagonal/Onion report `MODULE_ARCHITECTURE_UNIMPLEMENTED`; they never fall back to Clean.
- Invalid syntax, structure or references report their own errors before readiness, avoiding derivative failures.

The CLI never invokes the old global-layer generator for a modular configuration. It creates no output directory and starts no scaffold, dependency installation, Git command or remote publication. `init` still writes a valid canonical starter configuration and refuses overwrites. Restoring generation requires the resolved model (RF-05), direct pipeline (RF-07) and Clean modules (RF-09), followed by executable integration acceptance. This work does not establish database/browser acceptance or support all three architecture generators.

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

The reference's `MODULE_PRIVATE_IMPORT`, `MODULE_DEPENDENCY_UNDECLARED` and `ARCHITECTURE_DEPENDENCY_INVALID` concern generated/authored source boundaries, not YAML declarations. Those source checks belong with module generation. Module cycle validation is implemented now and is separate from the existing IR's entity foreign-key graph/order checks.

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
| Existing concrete renderer suites | Executable generated Hono routes and request guards, declared endpoint exposure, domain/application/persistence/frontend file contracts and deterministic IR/filesystem behavior |
| Documentation/sketch suites | Sample syntax/links, typechecked authored module communication and executable policy propagation sketch; these do not stand in for generated modular integration |

The selector compatibility matrix and its tests were removed together. Tests for v1 aliases, selectable ORM/provider/architecture combinations, URL-derived operation IDs and raw YAML-conversion exception leakage were replaced by the canonical functional checks. The old unreachable CLI generation orchestration was removed. Low-level renderer/composer tests remain while their internals still exist and must be replaced with the corresponding direct-generation checks when that production code is retired. No check is named after an issue.

Coverage includes all core source files, without excluding the new validators. The former absolute 100% gate is replaced by minimum 98% lines/statements/branches and 99% functions. This explicitly permits a small defensive/transitional branch gap without retaining obsolete selector tests or mocking parser internals merely to force a percentage. Coverage is supporting evidence; passing functional assertions, typechecking and builds remain mandatory. This policy change is part of the PR and is not a claim that every branch or every generated-project behavior has been verified.

Local verification on Node.js 24.21.0: 301 core tests across 22 suites and 12 CLI tests across two suites pass. Core coverage is 98.98% lines/statements, 98.15% branches and 99.55% functions. Package builds, root TypeScript checking and lint/import checks pass. Full Biome formatting also passes on an LF-normalized copy of all 84 source/config files, matching a Linux checkout; unrelated original Windows line endings were not reformatted. Seven built-CLI invocations verified invalid-version, invalid-database and recognized-but-unavailable generation errors, exit 1 and no generated output. CI must independently confirm the pushed commit.
