# @nordixgen/core

The core parses and validates strict YAML v2 for NordixGen's fixed stack. It checks module ownership, public operation references, independent module cycles, data relationships, explicit endpoint bindings, project paths, authentication and frontend access.

## Configuration API

```ts
import { readFile } from "node:fs/promises";
import { parseNordixYaml, formatDiagnostic } from "@nordixgen/core";

const file = "nordix.config.yaml";
const result = parseNordixYaml(await readFile(file, "utf8"), file);
if (!result.success) {
  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
} else {
  console.log(result.config.schemaVersion); // 2
}
```

`validateNordixConfig(input)` validates object input without invented source coordinates. `parseNordixYaml(source, filename)` attaches YAML line/column information. A successful result includes the canonical configuration and a transitional normalized endpoint view (effective authentication and pagination); it is not the complete resolved model planned for RF-05.

Pass `{ requireGeneration: true }` as the third parser argument to include shared readiness checks. All modular generation is currently blocked; Clean requires integration and Hexagonal/Onion have no renderer. The CLI always includes this preflight.

## Development and remaining internals

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm generate:schema
```

The editor schema is generated from the authoritative Zod definitions and a test checks exact equality with the checked-in file. IR format version 4 contains canonical applications and removes dormant deployment/Docker/AI settings. The existing virtual filesystem and concrete renderer tests remain useful low-level checks. Temporary fixed renderer views and the internal plugin composition machinery are scheduled for replacement by the resolved model and direct generation work; they are not a supported alternative v2 CLI pipeline.

See the [contract](../../docs/configuration/YAML_V2.md) and [validation/evidence guide](../../docs/configuration/VALIDATION.md). Keep credentials in environment configuration, never YAML.
