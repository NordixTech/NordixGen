# Contributing

Use Node.js 24.22.1+ and pnpm 10.5.2. The workspace has two packages: [core](../packages/core/README.md) validates/resolves and renders; [CLI](../packages/cli/README.md) owns filesystem changes, processes and publication.

## Run checks

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

For documentation-only changes:

```bash
pnpm --filter @nordixgen/core exec vitest run tests/configuration-documentation.test.ts
```

The documentation suite checks examples, local links and the typed communication sample. Also review anchors, technical claims and whether partial snippets are clearly labeled.

## Integration checks

`pnpm test:acceptance` generates fresh commerce applications and checks compilation, persistence, authorization and browser flows. It needs Docker and Chromium; output is ignored under `tmp/acceptance/commerce/`.

For Docker topology changes, run `pnpm example:docker monorepo` and `pnpm example:docker split`. Artifacts are written under ignored `tmp/docker-acceptance/`.

The persistence integration suite requires explicit isolated opt-in: database and user `nordixgen_test`, host `db.localtest.me`, `NORDIXGEN_TEST_DATABASE_URL`, and a local Neon proxy selected with `NORDIXGEN_TEST_PROXY_PORT` (default 14444). It resets that database and refuses other targets. Never use a client database. Without opt-in, local persistence checks are skipped.

## Documentation style

Write documentation in English for a developer learning the product. Explain the feature, show a small example, state defaults/restrictions and link the next relevant page. Keep issue history, implementation milestones and decision logs out of usage guides.

For a new capability, update its guide and configuration reference. Keep runtime requirements and limitations explicit. Do not claim that local tests establish every cloud/provider behavior.

Only example YAML inputs belong under `examples/`. Keep generated output, dependencies, credentials and measurements ignored. Maintain generated README/deployment templates when a source-changing task alters their behavior.
