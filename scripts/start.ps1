<#
.SYNOPSIS
  Builds (if needed) and starts the whole system.
.PARAMETER Cloud    Use HTTPS with an automatic certificate (docker-compose.cloud.yml).
.PARAMETER NoBuild  Use already built/imported images (offline onsite servers).
#>
param([switch]$Cloud, [switch]$NoBuild)
. "$PSScriptRoot\_common.ps1"
Assert-Docker
if (-not (Test-Path .env)) { & "$PSScriptRoot\setup.ps1" }

$compose = Get-ComposeArgs -Cloud:$Cloud
$up = @('up', '-d', '--wait')
if (-not $NoBuild) { $up += '--build' }
docker compose @compose @up
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed. Run .\scripts\logs.ps1 to see why.' }

$envMap = Read-DotEnv
Write-Host ''
Write-Host 'NOI CMS is running.' -ForegroundColor Green
if ($Cloud) {
    Write-Host "  https://$($envMap['SITE_ADDRESS'])"
} else {
    $port = if ($envMap['HTTP_PORT']) { $envMap['HTTP_PORT'] } else { '80' }
    $suffix = if ($port -eq '80') { '' } else { ":$port" }
    Write-Host "  This computer: http://localhost$suffix"
    foreach ($ip in Get-LanAddresses) { Write-Host "  LAN:           http://$ip$suffix" }
    Write-Host ''
    Write-Host '  If contestants cannot connect, allow the port in Windows Firewall:' -ForegroundColor DarkGray
    Write-Host "  New-NetFirewallRule -DisplayName 'NOI CMS' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow" -ForegroundColor DarkGray
}
Write-Host ''
Write-Host "  Admin user:     $($envMap['ADMIN_USERNAME'])"
Write-Host "  Admin password: $($envMap['ADMIN_PASSWORD'])"
Write-Host '  (from .env; only used to create the admin account on first start - if you changed it on the website, use that one)' -ForegroundColor DarkGray
