# Packages

The pnpm workspace contains two packages:

- [core](core/README.md): authoritative YAML v2 definitions, parsing, structural and semantic diagnostics, editor schema, immutable resolved project model, scoped views, virtual filesystem and built-in renderers.
- [cli](cli/README.md): interactive initialization, validation/readiness checks, direct backend/frontend generation, upstream scaffolding, dependency installation, generated application checks, mandatory local Git initialization and optional GitHub publication.

There are no separate plugin-hono or plugin-nextjs workspace packages. Built-in renderers live inside core and are ordinary internal functions, not extension APIs. Core prepares files in memory; CLI owns filesystem and process effects. Clean, Hexagonal and Onion modules can coexist in a generated backend.

Start with the [documentation index](../docs/README.md), [getting started](../docs/GETTING_STARTED.md) or [contributor guide](../docs/CONTRIBUTING.md). See [validation behavior and evidence](../docs/configuration/VALIDATION.md) for supported scope and checks.
