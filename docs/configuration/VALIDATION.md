# Validation

Validate a configuration before generating:

```bash
node packages/cli/dist/index.js validate -f nordix.config.yaml
```

A successful result means the configuration can be resolved and its requested mappings are supported for generation. It does not test your cloud credentials, provider availability or production application behavior.

## What is checked?

1. **YAML:** syntax, duplicate keys and unsafe constructs.
2. **Structure:** required fields, types, defaults, supported values and unknown keys.
3. **References:** repositories, databases, entities, modules, routes and permissions.
4. **Generation support:** whether requested operations/relations have supported mappings.

`generate` uses the same checks. Invalid/unsupported input fails before creating output or starting scaffold/install/publication commands. External tools may still fail later and leave partial output for inspection.

## Read diagnostics

Diagnostics use English messages with a configuration path and corrective action. YAML input also includes file, line and column; object API input has paths without source coordinates.

| Code / category | Common correction |
| --- | --- |
| `YAML_SYNTAX_ERROR` | Fix syntax or duplicate mapping keys |
| `CONFIG_FIELD_UNKNOWN` | Remove an unsupported key; check the current reference |
| `CONFIG_VERSION_UNSUPPORTED` | Use `schemaVersion: 2` |
| `DATABASE_SHARED_ACROSS_BACKENDS` | Give each persisted backend a dedicated resource |
| `ENTITY_OWNER_MISSING` / `ENTITY_OWNER_DUPLICATE` | Assign each entity to exactly one module |
| `MODULE_IMPORT_NOT_EXPORTED` | Export the operation from its owning module |
| `MODULE_DEPENDENCY_CYCLE` | Remove a synchronous import cycle |
| `CROSS_MODULE_RELATION` / `CROSS_MODULE_JOIN` | Keep SQL relationships inside module ownership |
| `RELATION_CYCLE` | Break the stored foreign-key cycle |
| `RELATION_MAPPING_UNIMPLEMENTED` | Avoid unsupported many-to-many generation |
| `MUTATION_GUARD_REQUIRED` | Add a required main-entity equality binding to update/delete |
| `OPERATION_MAPPING_UNSUPPORTED` | Use a supported endpoint mapping or author behavior after generation |
| `FRONTEND_IDENTITY_AMBIGUOUS` | Select `access.backend` explicitly |
| Permission/access errors | Declare known grants and compatible identity policies |

Names are checked after generated normalization too. A case-sensitive YAML name may still collide with another generated file/symbol. Change the declaration instead of relying on automatic renaming.

## Common limits

Old schemas are rejected rather than converted. Stored-FK and synchronous module cycles are unsupported. Relations and joins stay module-local. Clean, Hexagonal and Onion may coexist; architecture does not relax ownership rules.

Generation requires a new/empty destination and does not overwrite edited applications. Run [application checks](../EXTENDING_PROJECTS.md) after continuing development.
