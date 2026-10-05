<#
.SYNOPSIS
  Restores a backup made by backup.ps1. REPLACES all current data.
.EXAMPLE
  .\scripts\restore.ps1 .\backups\20261005-101500
#>
param([Parameter(Mandatory)][string]$BackupDir)
. "$PSScriptRoot\_common.ps1"
Assert-Docker
$BackupDir = (Resolve-Path $BackupDir).Path
foreach ($f in 'noi.dump', 'files.tar.gz') {
    if (-not (Test-Path (Join-Path $BackupDir $f))) { throw "$f not found in $BackupDir" }
}
$answer = Read-Host 'This deletes ALL current contests, users and submissions. Type RESTORE to continue'
if ($answer -ne 'RESTORE') { exit 1 }

docker compose up -d --wait postgres redis
docker compose stop web worker api

$pg = docker compose ps -q postgres
docker cp (Join-Path $BackupDir 'noi.dump') "${pg}:/tmp/noi.dump"
docker compose exec -T postgres pg_restore -U noi -d noi --clean --if-exists --no-owner /tmp/noi.dump
docker compose exec -T postgres rm -f /tmp/noi.dump

docker compose create api | Out-Null
$api = docker compose ps -aq api
docker run --rm --volumes-from $api -v "${BackupDir}:/backup" alpine sh -c 'rm -rf /data/* && tar xzf /backup/files.tar.gz -C /data'

# Jobs queued before the backup refer to old state; the API re-queues unfinished judgements on start.
docker compose exec -T -e REDISCLI_AUTH=$((Read-DotEnv)['REDIS_PASSWORD']) redis redis-cli FLUSHALL | Out-Null
docker compose up -d --wait
Write-Host 'Restore complete.' -ForegroundColor Green
