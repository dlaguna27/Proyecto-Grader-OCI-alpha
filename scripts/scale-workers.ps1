<#
.SYNOPSIS
  Changes the number of grading worker containers on this machine.
.EXAMPLE
  .\scripts\scale-workers.ps1 3
#>
param([Parameter(Mandatory)][int]$Count)
. "$PSScriptRoot\_common.ps1"
docker compose up -d --no-deps --scale "worker=$Count" worker
docker compose ps worker
