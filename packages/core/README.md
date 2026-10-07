# @nordixgen/core

The NordixGen core parses and validates `nordix.config.yaml`, resolves the configuration into a deterministic intermediate representation, and provides an in-memory virtual file system.

## Try the example

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nordixgen/core test
pnpm --filter @nordixgen/core build
pnpm generate:schema
```

The example configuration is in [`examples/ecommerce.yaml`](../../examples/ecommerce.yaml). The schema generator writes [`nordix.schema.json`](../../nordix.schema.json) for YAML editor autocomplete.

## Use the core APIs

```ts
import { readFile } from "node:fs/promises";
import {
  buildIntermediateRepresentation,
  formatDiagnostic,
  parseNordixYaml,
  VirtualFileSystem,
} from "@nordixgen/core";

const source = await readFile("examples/ecommerce.yaml", "utf8");
const result = parseNordixYaml(source);

if (!result.success) {
  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
  process.exitCode = 1;
} else {
  const representation = buildIntermediateRepresentation(result.config);
  console.log(representation.entityOrder);

  const output = new VirtualFileSystem();
  output.writeFile("nordix.intermediate-representation.json", `${JSON.stringify(representation, null, 2)}\n`);
  await output.emit("./generated");
}
```

`parseNordixYaml` returns structured diagnostics for YAML syntax, schema, semantic, and compatibility errors. `buildIntermediateRepresentation` sorts entities by their foreign-key dependencies, reports cycles, injects generated IDs and audit fields, and normalizes object ordering. The virtual file system writes files only when their contents change.
