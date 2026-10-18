# Packages

The pnpm workspace contains two packages:

- [core](core/README.md): authoritative YAML v2 definitions, parsing, structural and semantic diagnostics, generated editor schema, immutable resolved project model and scoped backend/module/frontend views, virtual filesystem and concrete renderer internals.
- cli: interactive canonical configuration initialization, configuration/readiness validation and generation preflight. Generation currently stops before any output or external commands because modular integration is incomplete.

There are no separate plugin-hono or plugin-nextjs workspace packages. Remaining renderer implementations live inside core and will move through the planned direct-generation refactor. See [validation behavior and evidence](../docs/configuration/VALIDATION.md).
