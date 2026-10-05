<#
.SYNOPSIS
  Follows logs. Example: .\scripts\logs.ps1 worker
#>
param([string]$Service = '')
. "$PSScriptRoot\_common.ps1"
if ($Service) { docker compose logs -f --tail 200 $Service } else { docker compose logs -f --tail 100 }
