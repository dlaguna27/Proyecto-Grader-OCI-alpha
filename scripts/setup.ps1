<#
.SYNOPSIS
  First-time setup: creates .env with random secrets.
.EXAMPLE
  .\scripts\setup.ps1
  .\scripts\setup.ps1 -Cloud -Domain contest.example.org -Email you@example.org
#>
param(
    [switch]$Cloud,
    [string]$Domain = '',
    [string]$Email = 'admin@example.org',
    [int]$HttpPort = 80,
    [switch]$Force
)
. "$PSScriptRoot\_common.ps1"

function New-Secret([int]$Length = 24) {
    $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

if ((Test-Path .env) -and -not $Force) {
    Write-Host '.env already exists. Use -Force to overwrite it (this changes the passwords!).' -ForegroundColor Yellow
    exit 1
}
if ($Cloud -and -not $Domain) { throw 'Cloud mode needs -Domain your.domain' }

$cores = [Environment]::ProcessorCount
$slots = [Math]::Max(1, $cores - 2)
$adminPassword = New-Secret 14
$site = if ($Cloud) { $Domain } else { ':80' }

@"
POSTGRES_PASSWORD=$(New-Secret 32)
REDIS_PASSWORD=$(New-Secret 32)
WORKER_TOKEN=$(New-Secret 48)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$adminPassword
HTTP_PORT=$HttpPort
SITE_ADDRESS=$site
ACME_EMAIL=$Email
JUDGE_SLOTS=$slots
WORKER_REPLICAS=1
SINGLE_SESSION=1
SUBMIT_PER_MINUTE=6
TZ=UTC
"@ | Set-Content -Encoding ascii .env

Write-Host 'Created .env' -ForegroundColor Green
Write-Host "  Admin user:     admin"
Write-Host "  Admin password: $adminPassword   (stored in .env; change it after first login)"
Write-Host "  Judge slots:    $slots (of $cores CPU threads)"
Write-Host ''
Write-Host 'Next: .\scripts\start.ps1' -NoNewline
if ($Cloud) { Write-Host ' -Cloud' } else { Write-Host '' }
