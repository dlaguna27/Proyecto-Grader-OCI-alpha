<#
.SYNOPSIS
  Shows container health and the grading queue size.
#>
. "$PSScriptRoot\_common.ps1"
docker compose ps
Write-Host ''
$waiting = docker compose exec -T -e REDISCLI_AUTH=$((Read-DotEnv)['REDIS_PASSWORD']) redis redis-cli ZCARD bull:judge:prioritized 2>$null
$wait2 = docker compose exec -T -e REDISCLI_AUTH=$((Read-DotEnv)['REDIS_PASSWORD']) redis redis-cli LLEN bull:judge:wait 2>$null
$active = docker compose exec -T -e REDISCLI_AUTH=$((Read-DotEnv)['REDIS_PASSWORD']) redis redis-cli LLEN bull:judge:active 2>$null
Write-Host "Grading queue: waiting=$([int]$waiting + [int]$wait2) active=$active"
