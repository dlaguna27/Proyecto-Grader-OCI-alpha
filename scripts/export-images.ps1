<#
.SYNOPSIS
  Builds all images and saves them to one .tar so an offline onsite server can run without internet.
.EXAMPLE
  .\scripts\export-images.ps1            # writes .\noi-cms-images.tar
  # copy the repo folder + tar to the onsite server (USB), then:
  .\scripts\import-images.ps1; .\scripts\start.ps1 -NoBuild
#>
param([string]$Output = 'noi-cms-images.tar')
. "$PSScriptRoot\_common.ps1"
Assert-Docker
docker compose build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
foreach ($img in 'postgres:16-alpine', 'redis:7-alpine', 'alpine:latest') { docker pull $img }
docker save -o $Output noi-cms-api:latest noi-cms-worker:latest noi-cms-web:latest postgres:16-alpine redis:7-alpine alpine:latest
if ($LASTEXITCODE -ne 0) { throw 'docker save failed' }
$size = [Math]::Round((Get-Item $Output).Length / 1MB)
Write-Host "Saved $Output ($size MB)" -ForegroundColor Green
