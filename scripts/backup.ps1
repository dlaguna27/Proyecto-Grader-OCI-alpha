<#
.SYNOPSIS
  Backs up the database and all uploaded files (tests, submissions) into .\backups\<timestamp>.
  Safe to run during a contest.
#>
param([string]$OutDir = '')
. "$PSScriptRoot\_common.ps1"
Assert-Docker
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $OutDir) { $OutDir = Join-Path $Root "backups\$stamp" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

Write-Host 'Dumping database...'
docker compose exec -T postgres pg_dump -U noi -d noi --format=custom --file=/tmp/noi.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
$pg = docker compose ps -q postgres
docker cp "${pg}:/tmp/noi.dump" (Join-Path $OutDir 'noi.dump')
docker compose exec -T postgres rm -f /tmp/noi.dump

Write-Host 'Archiving files...'
$api = docker compose ps -q api
docker run --rm --volumes-from $api -v "${OutDir}:/backup" alpine tar czf /backup/files.tar.gz -C /data .
if ($LASTEXITCODE -ne 0) { throw 'file archive failed' }

Write-Host "Backup written to $OutDir" -ForegroundColor Green
