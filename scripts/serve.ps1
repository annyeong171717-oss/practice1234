# Re-ric background server (installed to %LOCALAPPDATA%\Re-ric by deploy-local.ps1).
# Keeps `next start` alive on port 3123: restarts it whenever it exits. Single instance per user.
$ErrorActionPreference = 'Continue'
$root = Join-Path $env:LOCALAPPDATA 'Re-ric'
$node = Join-Path $root 'node\node.exe'
$app = Join-Path $root 'app'
$log = Join-Path $root 'server.log'
$port = 3123

$mutex = New-Object System.Threading.Mutex($false, 'Local\ReRicServer')
if (-not $mutex.WaitOne(0)) { exit }

if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item $log "$log.old" -Force }
$env:PATH = (Join-Path $root 'node') + ';' + $env:PATH
$env:NODE_ENV = 'production'

while ($true) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $busy) {
    Add-Content $log "[$(Get-Date -Format s)] starting server"
    Push-Location $app
    & $node 'node_modules\next\dist\bin\next' start -p $port *>> $log
    Pop-Location
    Add-Content $log "[$(Get-Date -Format s)] server exited (code $LASTEXITCODE)"
  }
  Start-Sleep -Seconds 5
}
