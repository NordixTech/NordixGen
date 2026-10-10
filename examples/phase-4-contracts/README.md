# Phase 4 entity and endpoint contracts

This example exercises the entity and endpoint improvements in PR #40 using the Hono, Clean Architecture, and Drizzle Golden Path.

## What to inspect

- `User` and `Order` show the multiline `timestamps` block and both soft-delete strategies. `OrderNote` omits `softDelete` to demonstrate the `false` default.
- `OrderStatus` and `UserStatus` are separate enums. Generation emits one enum module per definition.
- `Order.submittedAt` uses the tagged `now` default, resolved through the generated `Clock` port.
- The summary binds two filters to distinct entity fields with the same logical name, joins `User`, and opts into offset pagination. Other endpoints omit pagination.
- Path parameters use `{orderId}` and link to `Order.id`.
- Create and update bodies explicitly reuse the entity use-case schemas. The note endpoint maps its public `message` property to an entity field explicitly.
- `operationId` values provide stable names for endpoint DTOs and use cases. Generated authorization metadata preserves the neutral path template; framework route registration is handled in a later phase.

## Build and validate

Run these commands from the repository root:

```sh
pnpm install
pnpm build
node packages/cli/dist/index.js validate --file examples/phase-4-contracts/valid-contracts.yaml
```

The validation command should report one backend, three entities, and five endpoints.

## Generate a project

Generation invokes the Hono scaffold and installs dependencies, so it needs network access. The output directory must be new or empty.

PowerShell:

```powershell
$output = Join-Path $env:TEMP ("nordixgen-contracts-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $output | Out-Null
node packages/cli/dist/index.js generate --file examples/phase-4-contracts/valid-contracts.yaml --output $output
Get-ChildItem $output -Recurse -File
```

Bash:

```sh
output="$(mktemp -d "${TMPDIR:-/tmp}/nordixgen-contracts.XXXXXX")"
node packages/cli/dist/index.js generate --file examples/phase-4-contracts/valid-contracts.yaml --output "$output"
find "$output" -type f
```

Inspect the generated backend under `apps/api/src`. In particular, check the separate enum modules, the unpaginated and paginated endpoint DTOs, the endpoint-specific operation names, the typed path/query/body schemas, and the `Clock` port and adapter.
