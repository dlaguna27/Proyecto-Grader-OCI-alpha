<#
.SYNOPSIS
  Loads images saved by export-images.ps1 (offline onsite servers).
#>
param([string]$Path = 'noi-cms-images.tar')
. "$PSScriptRoot\_common.ps1"
Assert-Docker
docker load -i $Path
if ($LASTEXITCODE -ne 0) { throw 'docker load failed' }
Write-Host 'Images loaded. Start with: .\scripts\start.ps1 -NoBuild' -ForegroundColor Green
