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

Database resources are named under `databases`; each backend can optionally select a resource and ORM under `persistence`. The former root-level `database` property is no longer supported, and the intermediate representation uses format version 3 for this shape change. ORM identifiers are checked against registered, compatible plugins during composition. Keep credentials and connection strings in environment configuration, never in YAML.

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

Use `composeBackendPlugins(config, backendName, registry)` to resolve the framework, architecture, and optional ORM declared by a backend. It checks that each selected plugin is registered and that its declared capability requirements match the configured database engine and provider before any plugin contributes files.

The Hono framework plugin describes the pinned official `create-hono` Cloudflare Workers scaffold and runtime conventions. It consumes the selected architecture layout to generate the Worker entry point, route registration, and a health controller with imports derived from the final paths. Hono HTTP code stays in this framework plugin; architecture plugins only define semantic locations and dependency direction.

## Backend generator plugins

The core exposes contracts for architecture, framework, ORM, and authentication plugins. Hosts register plugin implementations; the core package does not hard-code Hono, Clean Architecture, Drizzle, or Better Auth. A plugin declares a stable identifier/version, role, provided capabilities, and required capabilities. The compatibility resolver checks the complete selection before calling any plugin.

Framework plugins resolve a `FrameworkContext` containing application/code roots, language, runtime, module system, entry points, and conventions. Architecture plugins receive that context and return an `ArchitectureLayout` with semantic file-role directories and dependency rules. Every plugin then contributes a list of relative POSIX file paths and contents. The composer normalizes paths, rejects collisions and unsafe paths, and returns a `VirtualFileSystem` only when the whole composition succeeds.

```ts
import {
  cleanArchitecturePlugin,
  composePlugins,
  formatDiagnostic,
  PluginRegistry,
  type GeneratorPlugin,
} from "@nordixgen/core";

// Plugin instances are supplied by the host's installed plugin packages.
declare const honoPlugin: GeneratorPlugin;
declare const drizzlePlugin: GeneratorPlugin;

const registry = new PluginRegistry();
registry.register(honoPlugin);
registry.register(cleanArchitecturePlugin);
registry.register(drizzlePlugin);

const result = composePlugins({
  registry,
  selections: [
    { pluginId: "hono", configuration: { applicationRoot: "apps/api" } },
    { pluginId: "clean" },
    { pluginId: "drizzle" },
  ],
});

if (!result.success) {
  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
} else {
  await result.virtualFileSystem.emit("./generated");
}
```

Each backend composition requires one framework and one architecture plugin. Other roles are selected only when needed. Capability identifiers are declared by plugins (for example, `runtime:cloudflare-workers` or `orm:drizzle`); incompatible or missing required capabilities produce diagnostics before contribution begins. Every contributing plugin receives the set of capabilities available in that composition. Optional capability requirements produce warnings and let the plugin choose a fallback based on that set.

`cleanArchitecturePlugin` is a framework-independent strategy exported by the core. It resolves semantic directories and dependency directions from the selected framework's code root. New architecture strategies can implement the same plugin contract and be registered alongside it; core does not need to change.
