<#
.SYNOPSIS
  Stops all containers. Data (database, files) is kept in Docker volumes.
#>
param([switch]$Cloud)
. "$PSScriptRoot\_common.ps1"
docker compose @(Get-ComposeArgs -Cloud:$Cloud) down
