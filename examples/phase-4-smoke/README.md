# Phase 4 smoke tests

These fixtures exercise YAML validation and the Hono + Clean Architecture + Drizzle generation path through phases 4.5–4.7. Generated source remains framework/ORM-neutral in the domain and application layers; the selected plugins contribute the Hono and Drizzle integration separately.

## Build the local CLI

From the repository root:

```sh
pnpm install
pnpm --filter @nordixgen/core build
pnpm --filter @nordixgen/cli build
```

## Validate the successful configuration

```sh
node packages/cli/dist/index.js validate --file examples/phase-4-smoke/valid-golden-path.yaml
```

The command should report the YAML as valid, with one backend, three entities, and two endpoints.

## Generate a project

Generation uses the Hono scaffold and installs generated dependencies, so it needs network access. The output directory must be new or empty.

PowerShell:

```powershell
$output = Join-Path $env:TEMP "nordixgen-phase-4-smoke"
if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
node packages/cli/dist/index.js generate --file examples/phase-4-smoke/valid-golden-path.yaml --output $output
Get-ChildItem $output -Recurse -File
```

Bash:

```sh
output="${TMPDIR:-/tmp}/nordixgen-phase-4-smoke"
rm -rf "$output"
node packages/cli/dist/index.js generate --file examples/phase-4-smoke/valid-golden-path.yaml --output "$output"
find "$output" -type f
```

Inspect the generated files under `apps/api/src/domain/entities`, `apps/api/src/application`, and `apps/api/src/infrastructure`. The application output includes CRUD use cases, request/response DTOs, a pagination/filter contract, and the declared joined summary query. The CLI adds Zod to the generated backend package.

## Verify expected failures

Each command below should exit nonzero and print the listed diagnostic. `generate` performs plugin compatibility checks before creating its output directory.

```sh
node packages/cli/dist/index.js generate --file examples/phase-4-smoke/invalid-unregistered-orm.yaml --output /tmp/nordixgen-invalid-orm
```

Expected: `PLUGIN_NOT_REGISTERED` for `missing-orm`.

```sh
node packages/cli/dist/index.js validate --file examples/phase-4-smoke/invalid-neon-engine.yaml
```

Expected: `INCOMPATIBLE_NEON_DATABASE`; Neon cannot be paired with MySQL.

```sh
node packages/cli/dist/index.js validate --file examples/phase-4-smoke/invalid-endpoint-entity.yaml
```

Expected: `UNKNOWN_ENDPOINT_ENTITY` because the endpoint refers to an undeclared entity.

PowerShell users can replace `/tmp/nordixgen-invalid-orm` with `(Join-Path $env:TEMP "nordixgen-invalid-orm")`.
