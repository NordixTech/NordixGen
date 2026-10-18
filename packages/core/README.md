# @nordixgen/core

The core parses strict YAML v2 and resolves it once into a typed, immutable project model. Backend, module and frontend consumers share resolved fields, operation contracts, ownership, policies and independent dependency graphs.

## Resolution API

```ts
import { readFile } from "node:fs/promises";
import { resolveProjectYaml, backendView, moduleView, frontendView,
  formatDiagnostic } from "@nordixgen/core";

const file = "nordix.config.yaml";
const result = resolveProjectYaml(await readFile(file, "utf8"), file);
if (!result.success) {
  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
} else {
  const project = result.project; // formatVersion: 5, deeply frozen
  console.log(project.moduleOrder, project.entityOrder, project.readiness);
  // Select declared names; views never parse or validate again.
  const backend = backendView(project, "api");
  const module = moduleView(project, "api.notes");
  const frontend = frontendView(project, "web");
}
```

`resolveProject(input, options?)` accepts object input without invented source coordinates. `resolveProjectYaml(source, filename?, options?)` attaches YAML source locations. Pass `{ requireGeneration: true }` as resolution options to require readiness as well. Both CLI commands use this same resolution/preflight. The direct backend flow supports one Clean module per backend; multiple-module integration is pending and Hexagonal/Onion have no renderer. Many-to-many generation also has an explicit readiness diagnostic.

`parseNordixYaml(source, filename?)` and `validateNordixConfig(input)` remain configuration-only APIs. They return canonical configuration, not a normalized renderer model; the parser no longer accepts generation options. The old IR builder, normalized-configuration API and renderer field/name inference have been removed. Use the [resolved model guide](../../docs/configuration/RESOLVED_MODEL.md) for value mapping, views and public contract boundaries.

## Development and remaining internals

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm generate:schema
```

The editor schema comes from the authoritative Zod definitions; a test checks exact equality. Concrete renderer tests execute generated Hono handlers and compile generated application/client contracts. They do not establish database or browser acceptance. Backend and frontend generation use direct typed functions over resolved views. See [backend](../../docs/generation/DIRECT_BACKEND.md) and [frontend](../../docs/generation/DIRECT_FRONTEND.md) scope, ownership and verification; multiple-module Clean assembly remains the next integration.

See the [contract](../../docs/configuration/YAML_V2.md) and [validation/evidence guide](../../docs/configuration/VALIDATION.md). Keep credentials in environment configuration, never YAML.
