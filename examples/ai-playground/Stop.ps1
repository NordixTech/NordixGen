$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
& docker compose --project-name nordixgen-ai-playground-current --env-file (Join-Path $repoRoot 'tmp/ai-playground.env') --file (Join-Path $repoRoot 'tmp/ai-playground-current/docker-compose.yml') down
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the example.' }
