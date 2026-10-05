# Shared helpers for the NOI CMS PowerShell scripts.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-Docker {
    try { docker info --format '{{.ServerVersion}}' *> $null } catch { }
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker is not running. Start Docker Desktop (WSL2 backend) and try again.'
    }
}

function Get-ComposeArgs([switch]$Cloud) {
    $files = @('-f', 'docker-compose.yml')
    if ($Cloud) { $files += @('-f', 'docker-compose.cloud.yml') }
    return $files
}

function Get-LanAddresses {
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -ExpandProperty IPAddress
}

function Read-DotEnv {
    $map = @{}
    if (Test-Path .env) {
        foreach ($line in Get-Content .env) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $map[$Matches[1]] = $Matches[2] }
        }
    }
    return $map
}
