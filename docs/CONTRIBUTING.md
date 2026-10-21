# Contribute to NordixGen

Run generator development commands in this checkout using Node.js 24+ and pnpm 10.5.2. See the [package map](../packages/README.md) for ownership. Core validates/resolves and renders in memory; CLI owns external processes, files, scaffolds, installation and publication. Keep one resolved source of operation, access and frontend contracts.

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

For a documentation-only change, run the existing documentation suite without the whole-package coverage gate:

```bash
pnpm --filter @nordixgen/core exec vitest run tests/configuration-documentation.test.ts
```

It checks example YAML syntax, maintained local documentation links and the typed module-communication sketch. It does not prove that every explanatory claim or Markdown anchor is correct; review those separately. All Markdown, snippets, explanatory comments and user-facing prose should use English. Preserve external proper names and exact API identifiers.

For behavior changes, run affected functional suites plus the required checks. The [validation guide](configuration/VALIDATION.md) describes diagnostics, compiler/runtime evidence and coverage gates. Do not lower gates or present skipped integration tests as passing database verification.

## Generated-application acceptance

`pnpm test:acceptance` creates fresh commerce applications and verifies compilation, isolated PostgreSQL, authorization and browser behavior. Docker and Chromium are required; artifacts go under ignored `tmp/acceptance/commerce/`. For Docker topology changes, run `pnpm example:docker monorepo` and `pnpm example:docker split`; output goes under `tmp/docker-acceptance/`.

The separate persistence suite requires explicit isolated database/proxy opt-in and resets its test database. Follow the exact host/user/database restrictions in [module verification](generation/CLEAN_MODULES.md#evidence-and-limits). Never point it at a client database or infer its target from an ambient production `DATABASE_URL`.

Only example YAML sources belong under `examples/`. Generated trees, dependencies, credentials and measurements remain ignored. The commerce, configuration and performance fixtures are regression inputs; removing or changing them can affect CI. Keep acceptance scripts/adapters under the CLI tests rather than shipping them as client examples.

## Keep documentation aligned

When adding a capability, update its accepted YAML/defaults, runtime behavior, setup and environment requirements, failure cases and limitations. Add an entry to the [capability map](CAPABILITIES.md) and link a new guide from the [index](README.md) when useful. Distinguish product intent, generated functionality, local test evidence and destination-environment verification. Update generated-project documentation templates only in a task that authorizes generator/source changes.

Do not keep obsolete implementation milestones as current instructions. There is no maintained `IMPLEMENTATION_PLAN.md`; use the specification, capability map and validation evidence. Generated repository guides are a separate documentation surface and must stay synchronized when their producing code changes.

## Documentation audit scope for issue #9

The documentation review covers tracked Markdown guides and package READMEs, cross-references, configuration examples and claims checked against the current source. Existing maintained Markdown was already English; the review corrects stale claims and adds task-oriented coverage rather than claiming a translation where none was needed. It does not rewrite existing Git history, fixtures, generated runtime strings or generator templates.

One known source localization gap remains in `packages/core/src/generation/auth-delivery.ts`: the generated delivery-unavailable error is Spanish. A follow-up code change should translate it to “The delivery service is temporarily unavailable. Contact your administrator.” and update any affected assertions. That work is intentionally outside the documentation-only scope; the broader issue's acceptance criterion of exclusively English source and CLI/runtime output must not be marked complete on the strength of this documentation PR alone.
