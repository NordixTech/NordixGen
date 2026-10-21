$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output = Join-Path $repoRoot 'tmp/ai-playground-current'
$envFile = Join-Path $repoRoot 'tmp/ai-playground.env'
if (!(Test-Path $envFile)) { throw 'Run examples/ai-playground/Set-GroqKey.ps1 first.' }
Push-Location $repoRoot
try {
    # Prefer the pinned local toolchain when available on this checkout.
    $pinnedBin = Join-Path $repoRoot 'tmp/pnpm/node_modules/.bin'
    $previousPath = $env:PATH
    if (Test-Path $pinnedBin) { $env:PATH = "$pinnedBin;$env:PATH" }
    if (!(Test-Path (Join-Path $output 'docker-compose.yml'))) {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'Generator build failed.' }
        & node packages/cli/dist/index.js generate --file examples/ai-playground/nordix.yaml --output $output
        if ($LASTEXITCODE -ne 0) { throw 'Example generation failed.' }
    }
    & docker compose --project-name nordixgen-ai-playground-current --env-file $envFile --file (Join-Path $output 'docker-compose.yml') up --detach --build --wait
    if ($LASTEXITCODE -ne 0) { throw 'Example startup failed.' }
    Write-Host 'Chat: http://localhost:3100/chat'
    Write-Host 'MCP connections: http://localhost:3100/connect-ai'
    Write-Host 'MCP endpoint: http://localhost:8791/mcp'
} finally {
    if ($null -ne $previousPath) { $env:PATH = $previousPath }
    Pop-Location
}
