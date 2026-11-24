# Run on the LAPTOP (PowerShell, in C:\Users\Moham\FuelPro) to send the real data to the VPS — only when you have decided
# that the server becomes the one live system (CLAUDE.md §5: moving real data needs your OK each time).
#   powershell -ExecutionPolicy Bypass -File deploy\vps\laptop-send-data.ps1 -Server ubuntu@203.0.113.10
# 1) makes a fresh consistent backup (npm run backup)  2) copies it and data\app-secret.txt to the server over SSH
# 3) prints the one command to run on the server. Nothing on the laptop is changed or deleted.
param([Parameter(Mandatory = $true)][string]$Server)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
node --disable-warning=ExperimentalWarning scripts/backup.js
$bk = Get-ChildItem data\backups\fuelpro-*.db | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "sending $($bk.Name) ($([math]::Round($bk.Length / 1MB, 1)) MB) to $Server"
scp $bk.FullName "${Server}:/var/lib/fuelpro/incoming/"
$secretArg = ''
if (Test-Path data\app-secret.txt) { scp data\app-secret.txt "${Server}:/var/lib/fuelpro/incoming/app-secret.txt"; $secretArg = ' --app-secret-file /var/lib/fuelpro/incoming/app-secret.txt' }
Write-Host ''
Write-Host 'Now run this ON THE SERVER (it checks the file first and asks before replacing anything):'
Write-Host "  ssh $Server"
Write-Host "  sudo fuelpro-restore /var/lib/fuelpro/incoming/$($bk.Name)$secretArg"
Write-Host ''
Write-Host 'Afterwards enter new data on the server only (open the https address on the laptop too), so the two copies never disagree.'
