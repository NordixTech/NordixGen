param([string]$Model = 'openai/gpt-oss-20b')
$ErrorActionPreference = 'Stop'
if ($Model -notmatch '^[a-zA-Z0-9._/-]+$') { throw 'Invalid model identifier.' }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$secretFile = Join-Path $repoRoot 'tmp/ai-playground.env'
New-Item -ItemType Directory -Force (Split-Path $secretFile) | Out-Null
$secureKey = Read-Host 'Groq API key (hidden)' -AsSecureString
try {
    $plainKey = [System.Net.NetworkCredential]::new('', $secureKey).Password.Trim()
    if ($plainKey -notmatch '^[a-zA-Z0-9_-]{20,}$') { throw 'Invalid Groq API key format.' }
    $settings = @(
        "API_GROQ_API_KEY='$plainKey'"
        "API_AI_MODEL='$Model'"
        'FRONTEND_WEB_PORT=3100'
        'MCP_API_PORT=8791'
        'API_MCP_PUBLIC_URL=http://localhost:8791'
        'POSTGRES_API_PORT=55433'
        'MAILPIT_API_PORT=8026'
    )
    [IO.File]::WriteAllLines($secretFile, $settings, [Text.UTF8Encoding]::new($false))
} finally {
    $plainKey = $null
    $settings = $null
    $secureKey.Dispose()
}
Write-Host 'Key saved in the ignored local environment file. Its value was not displayed.'
Write-Host 'Run Start.ps1 to start the example or apply the updated key.'
