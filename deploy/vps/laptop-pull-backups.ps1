# Run on the LAPTOP to keep an off-server copy of the VPS data (the server's own backups live on the same disk as its database).
#   powershell -ExecutionPolicy Bypass -File deploy\vps\laptop-pull-backups.ps1 -Server ubuntu@203.0.113.10 [-Dest D:\FuelPro-VPS-backups]
# Copies the newest server backup (the server makes one per day, keeps 30). Schedule it daily with Windows Task Scheduler.
param([Parameter(Mandatory = $true)][string]$Server, [string]$Dest = "$env:USERPROFILE\FuelPro-VPS-backups")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$name = (ssh $Server "ls -1t /var/lib/fuelpro/backups/fuelpro-*.db | head -1").Trim()
if (-not $name) { throw 'no backup found on the server yet' }
$local = Join-Path $Dest (Split-Path $name -Leaf)
if (Test-Path $local) { Write-Host "already here: $local"; exit 0 }
scp "${Server}:$name" $local
Write-Host "copied $local ($([math]::Round((Get-Item $local).Length / 1MB, 1)) MB)"
