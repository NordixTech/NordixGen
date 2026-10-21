# Core API

Use `@nordixgen/core` to validate configuration, resolve a typed project and prepare generated files in memory. The CLI adds filesystem changes and external commands.

## Resolve YAML

```ts
import { readFile } from "node:fs/promises";
import { resolveProjectYaml, backendView, formatDiagnostic } from "@nordixgen/core";

const filename = "nordix.config.yaml";
const result = resolveProjectYaml(await readFile(filename, "utf8"), filename, {
  requireGeneration: true,
});

if (!result.success) {
  for (const diagnostic of result.diagnostics) {
    console.error(formatDiagnostic(diagnostic));
  }
} else {
  const backend = backendView(result.project, "api");
  console.log(backend);
}
```

`resolveProject(input, options?)` accepts an object instead of YAML. It reports configuration paths without source coordinates. Resolution does not mutate/freeze the caller's input.

Use `parseNordixYaml` or `validateNordixConfig` for configuration-only APIs. Set `requireGeneration: true` when you also need supported-generation checks.

## Scoped views

| Function | Selects |
| --- | --- |
| `backendView(project, "api")` | Backend-owned modules, platform and operations |
| `moduleView(project, "api.notes")` | A backend-qualified business module |
| `frontendView(project, "web")` | Connected operation contracts and frontend metadata |

Views select existing resolved data; they do not parse or validate again. Unknown targets fail explicitly. The resolved project is deeply readonly/frozen and contains ownership, defaults, policies and separate module/FK dependency graphs.

## Value mapping

| Value | Application | HTTP/frontend |
| --- | --- | --- |
| Date | `Date` | UTC ISO string |
| Number | Finite JavaScript number | JSON number |
| Nullable stored field | Value or null | Required property with value or null |
| Optional input | Omission distinct from null | Same distinction |
| JSON | JSON-compatible value | JSON value |

Application inputs are flat named values, with trusted context separate. Frontend contracts expose declared HTTP operations, not private module implementations.

## Prepare output

`generateBackend(project, backendName)` and `generateFrontend(project, frontendName)` return files/dependency information without starting commands or writing output. The package also exposes diagnostics, JSON Schema and virtual-file collection/emission APIs.

Concrete framework/ORM/UI renderers are internal. There is no public alternate-stack plugin registry. For normal application use, prefer the [CLI](../GETTING_STARTED.md).
