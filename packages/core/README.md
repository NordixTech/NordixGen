# @nordixgen/core

The core library validates YAML v2, resolves a readonly project model and prepares backend/frontend output in memory.

```ts
import { resolveProjectYaml, generateBackend } from "@nordixgen/core";

const result = resolveProjectYaml(source, "nordix.config.yaml", {
  requireGeneration: true,
});

if (result.success) {
  const output = generateBackend(result.project, "api");
  // The caller decides how to emit files and execute scaffold/install commands.
}
```

Use `resolveProject` for object input; `backendView`, `moduleView` and `frontendView` select scoped resolved data. `parseNordixYaml` and `validateNordixConfig` provide configuration-only checks.

Public APIs also cover diagnostics, editor JSON Schema and virtual-file collection/emission. Concrete framework, ORM, authentication and UI renderers are internal rather than plugin extension points.

Read the [Core API guide](../../docs/configuration/RESOLVED_MODEL.md), [YAML reference](../../docs/configuration/YAML_V2.md) and [contributor instructions](../../docs/CONTRIBUTING.md).
