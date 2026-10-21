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

`resolveProject(input, options?)` accepts object input without invented source coordinates. `resolveProjectYaml(source, filename?, options?)` attaches YAML source locations. Pass `{ requireGeneration: true }` as resolution options to require readiness as well. Both CLI commands use this same resolution/preflight. The direct backend flow supports Clean, Hexagonal and Onion modules with unchanged typed public contracts. Many-to-many generation also has an explicit readiness diagnostic.

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

The editor schema comes from the authoritative Zod definitions; a test checks exact equality. Concrete renderer tests execute generated Hono handlers and compile generated application/client contracts. The maintained [commerce example](../../examples/full-stack-commerce/README.md) additionally runs fresh CLI generation, PostgreSQL and browser verification with `pnpm example:commerce`. Backend and frontend generation use direct typed functions over resolved views. See [backend](../../docs/generation/DIRECT_BACKEND.md) and [frontend](../../docs/generation/DIRECT_FRONTEND.md) scope, ownership and verification; [public application wiring](../../docs/generation/PUBLIC_MODULES.md) is integrated.

See the [contract](../../docs/configuration/YAML_V2.md) and [validation/evidence guide](../../docs/configuration/VALIDATION.md). Keep credentials in environment configuration, never YAML.

## Supported package boundary

Public exports cover configuration parsing/validation and JSON Schema, immutable project resolution/views/types, `generationReadiness`, `generateBackend`/`generateFrontend`, diagnostics, VFS collection/emission and the scaffold/tooling records used by the CLI. Generation returns files and dependencies in memory; the CLI owns external commands and publication. Concrete architecture, HTTP, ORM, authentication, styling and UI renderers and their contexts are internal implementation details, not supported extension points. No registry/composer or alternate-stack API is exported.

This is an initializer for new/empty projects. It does not regenerate edited applications, convert previous schemas, provision cloud resources or coordinate cross-module transactions. Clean, Hexagonal and Onion are executable; many-to-many generation still fails readiness explicitly.
