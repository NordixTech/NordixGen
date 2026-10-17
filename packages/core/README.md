# @nordixgen/core

`@nordixgen/core` contains the current configuration and file-generation primitives used by the NordixGen CLI:

- YAML parsing and diagnostics.
- Zod structural validation and semantic project validation.
- Normalization of entities, endpoints, relations, pagination, and backend/frontend connections.
- Generator composition and an in-memory virtual file system with safe paths and collision checks.

The current project schema and implementation are still the legacy pre-refactor design. The backend currently selects architecture at backend level, and only the Clean generator is registered. The schema also accepts `modular`, but there is no registered generator for it. Hexagonal and Onion output, per-business-module architecture, explicit intermodule contracts, and the new YAML are target work tracked in [RF-03](https://github.com/NordixTech/NordixGen/issues/64); they are not supported inputs or outputs yet.

The generic registries, capability negotiation, and framework/architecture/ORM plugin contracts visible in this package describe how the current implementation is assembled. They are internal legacy implementation details scheduled for simplification under the [v1.1.0 refactor](https://github.com/NordixTech/NordixGen/milestone/2), not a stable public API for third-party generator plugins.

## Try the package

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nordixgen/core test
pnpm --filter @nordixgen/core build
pnpm generate:schema
```

The generated `nordix.schema.json` is derived from the current Zod schema for editor completion. It reflects the current schema, not the planned YAML v2 module design.

## Core APIs

```ts
import { readFile } from "node:fs/promises";
import {
  buildIntermediateRepresentation,
  formatDiagnostic,
  parseNordixYaml,
  VirtualFileSystem,
} from "@nordixgen/core";

const source = await readFile("nordix.config.yaml", "utf8");
const result = parseNordixYaml(source);

if (!result.success) {
  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
  process.exitCode = 1;
} else {
  const representation = buildIntermediateRepresentation(result.config);
  console.log(representation.entityOrder);

  const output = new VirtualFileSystem();
  output.writeFile(
    "nordix.intermediate-representation.json",
    `${JSON.stringify(representation, null, 2)}\n`,
  );
  await output.emit("./generated");
}
```

`parseNordixYaml` reports YAML syntax, schema, and semantic diagnostics. The intermediate representation currently adds generated entity fields, sorts declarations, resolves relations and pagination, and scopes input to backend/frontend consumers. `VirtualFileSystem` stores generated files in memory and emits safe relative paths.

Use the CLI's `validate` and `generate` commands for normal project workflows. The lower-level composition APIs and plugin contracts are subject to change as the refactor removes generic technology selection.

## Current generation stack

Current generated projects use Next.js and Tailwind on the frontend and Hono, Drizzle, and PostgreSQL/Neon on the backend. Better Auth supplies identity and session handling. TanStack Query handles remote data and Zustand handles shared frontend UI state. The configured upstream scaffold currently uses the Hono Cloudflare Workers template; that does not mean NordixGen generates deployment configuration, provisions cloud resources, or deploys a client project.

`authUI` generates authentication screens and account controls, but does not protect frontend pages. Backend endpoints enforce server-side authentication and configured static roles/permissions. The current renderer also emits entity-derived CRUD routes; [RF-02](https://github.com/NordixTech/NordixGen/issues/63) defines their removal so declared endpoints become the only business HTTP route source.
