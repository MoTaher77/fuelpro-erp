param([int]$Port = 3000)
# FuelPro online: the server runs on this laptop and is reached from anywhere over HTTPS through a Cloudflare Tunnel.
# Only the tunnel can reach the server (it listens on 127.0.0.1); secure cookies, HSTS and proxy-aware rate limits are on.
#   Quick tunnel (no account): a new https://<random>.trycloudflare.com address on every start.
#   Named tunnel (fixed address on your domain): put the tunnel name in data\tunnel-name.txt and its public address in data\tunnel-url.txt
#   (see docs\DEPLOYMENT.md, "Online through a Cloudflare Tunnel").
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'FuelPro Online'
function Say($m, $c = 'Cyan') { Write-Host $m -ForegroundColor $c }
$app = $PSScriptRoot; Set-Location $app

# 1) Node.js 22.5+
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node -and (Test-Path 'C:\Program Files\nodejs\node.exe')) { $env:Path = 'C:\Program Files\nodejs;' + $env:Path; $node = Get-Command node -ErrorAction SilentlyContinue }
if (-not $node) { Say 'Node.js غير موجود. ثبّته من https://nodejs.org ثم أعد التشغيل.' Red; Read-Host 'Enter'; exit 1 }
$flags = @('--disable-warning=ExperimentalWarning')

# 2) cloudflared
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")) { if (-not $cf -and (Test-Path $p)) { $cf = $p } }
if (-not $cf) { Say 'cloudflared غير مثبّت. ثبّته بالأمر:  winget install --id Cloudflare.cloudflared  ثم أعد التشغيل.' Red; Read-Host 'Enter'; exit 1 }

# 3) data and the secret that encrypts two-factor keys (created once, kept in data\, never printed)
$data = Join-Path $app 'data'; New-Item -ItemType Directory -Force $data | Out-Null
$db = Join-Path $data 'fuelpro.db'
if (-not (Test-Path $db)) { Say "لم أجد قاعدة البيانات $db" Red; Read-Host 'Enter'; exit 1 }
$secretFile = Join-Path $data 'app-secret.txt'
if (-not (Test-Path $secretFile)) {
  $b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [IO.File]::WriteAllText($secretFile, [Convert]::ToBase64String($b))
  Say 'أُنشئ مفتاح تشفير التحقق الثنائي في data\app-secret.txt — احتفظ بنسخة منه مع النسخ الاحتياطية.' Yellow
}

# 4) start the tunnel first, so the public address is known before the server starts
$named = Join-Path $data 'tunnel-name.txt'; $namedUrl = Join-Path $data 'tunnel-url.txt'
$log = Join-Path $env:TEMP 'fuelpro-tunnel.log'; if (Test-Path $log) { Remove-Item $log -Force }
if (Test-Path $named) {
  $name = (Get-Content $named -Raw).Trim()
  $url = if (Test-Path $namedUrl) { (Get-Content $namedUrl -Raw).Trim() } else { '' }
  $tunnel = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port", 'run', $name) -RedirectStandardError $log -WindowStyle Hidden -PassThru
} else {
  $tunnel = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port") -RedirectStandardError $log -WindowStyle Hidden -PassThru
  $url = ''
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $log) { $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
  }
  if (-not $url) { Say 'تعذّر فتح النفق. تأكد من اتصال الإنترنت ثم أعد المحاولة.' Red; Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue; Read-Host 'Enter'; exit 1 }
}

# 5) the server, reachable only through the tunnel (and from this laptop at http://localhost:$Port)
$env:DB_PATH = $db; $env:PORT = "$Port"; $env:HOST = '127.0.0.1'
$env:COOKIE_SECURE = '1'; $env:TRUST_PROXY = '1'
$env:APP_SECRET = (Get-Content $secretFile -Raw).Trim()
if ($url) { $env:APP_URL = $url }
Say ''
Say '==============================================' Green
if ($url) { Say "FuelPro متاح من أي مكان على:  $url" Green; try { Set-Clipboard $url; Say '(نُسخ الرابط)' Gray } catch {} }
else { Say 'النفق المسمّى يعمل. افتح عنوان نطاقك.' Green }
Say "وعلى هذا الجهاز:  http://localhost:$Port" Green
Say '==============================================' Green
Say 'لا تغلق هذه النافذة. للإيقاف اضغط Ctrl+C.' Yellow
try { & node @flags src\server.js }
finally { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue; Say 'أُوقف الخادم والنفق.' Gray }
