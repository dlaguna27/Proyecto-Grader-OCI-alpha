<#
.SYNOPSIS
  Runs extra grading workers on ANOTHER Windows PC (Docker Desktop) to add judging capacity.
  The main server must expose Redis and the API to this PC (see README "Extra judge machines").
.EXAMPLE
  .\scripts\add-judge-machine.ps1 -Server 192.168.1.10 -WorkerToken <WORKER_TOKEN> -RedisPassword <REDIS_PASSWORD>   (both from the server .env)
#>
param(
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$WorkerToken,
    [Parameter(Mandatory)][string]$RedisPassword,
    [int]$Slots = [Math]::Max(1, [Environment]::ProcessorCount - 2),
    [int]$ApiPort = 3000,
    [int]$RedisPort = 6379
)
. "$PSScriptRoot\_common.ps1"
Assert-Docker
docker rm -f noi-extra-worker 2>$null | Out-Null
docker run -d --name noi-extra-worker --restart unless-stopped --privileged `
    -e "REDIS_URL=redis://:${RedisPassword}@${Server}:${RedisPort}" `
    -e "API_INTERNAL_URL=http://${Server}:${ApiPort}" `
    -e "WORKER_TOKEN=$WorkerToken" `
    -e "JUDGE_SLOTS=$Slots" `
    -e "WORKER_NAME=$env:COMPUTERNAME" `
    noi-cms-worker:latest
if ($LASTEXITCODE -ne 0) { throw 'failed to start worker (did you import/build noi-cms-worker?)' }
Write-Host "Extra worker started with $Slots slot(s). Check it appears in Admin > Queue." -ForegroundColor Green
