# Build the project into %LOCALAPPDATA%\Re-ric\app and (re)start the always-on local server.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\deploy-local.ps1
# The project lives under OneDrive with a non-ASCII path, which breaks Node; so it is built from an ASCII copy.
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$root = Join-Path $env:LOCALAPPDATA 'Re-ric'
$app = Join-Path $root 'app'
$nodeDir = Join-Path $root 'node'
$legacyNode = Join-Path $env:TEMP 'node22\node-v22.11.0-win-x64'
$legacyBuild = Join-Path $env:TEMP 'reric-build'
$port = 3123

New-Item -ItemType Directory -Force $root, $app | Out-Null

# 1. Portable Node runtime
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  if (Test-Path (Join-Path $legacyNode 'node.exe')) {
    robocopy $legacyNode $nodeDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
  } else {
    $zip = Join-Path $env:TEMP 'node-v22.11.0-win-x64.zip'
    Invoke-WebRequest 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip' -OutFile $zip
    Expand-Archive $zip -DestinationPath $root -Force
    Move-Item (Join-Path $root 'node-v22.11.0-win-x64') $nodeDir
  }
}
$env:PATH = "$nodeDir;$env:PATH"

# 2. Sources (+ reuse dependencies and stored data from the old TEMP build the first time)
robocopy $project $app /E /XD node_modules .next .git Practice .data /XF app.css /NFL /NDL /NJH /NJS /NP | Out-Null
if (-not (Test-Path (Join-Path $app 'node_modules')) -and (Test-Path (Join-Path $legacyBuild 'node_modules'))) {
  robocopy (Join-Path $legacyBuild 'node_modules') (Join-Path $app 'node_modules') /E /NFL /NDL /NJH /NJS /NP | Out-Null
}
if (-not (Test-Path (Join-Path $app '.data')) -and (Test-Path (Join-Path $legacyBuild '.data'))) {
  robocopy (Join-Path $legacyBuild '.data') (Join-Path $app '.data') /E /NFL /NDL /NJH /NJS /NP | Out-Null
}

Push-Location $app
try {
  if (-not (Test-Path 'node_modules')) { npm install --no-audit --no-fund }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}
Copy-Item (Join-Path $app 'public\css\app.css') (Join-Path $project 'public\css\app.css') -Force

# 3. Always-on server: watchdog script + auto start at Windows logon
Copy-Item (Join-Path $PSScriptRoot 'serve.ps1') (Join-Path $root 'serve.ps1') -Force
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'Re-ric server.vbs'
$serve = Join-Path $root 'serve.ps1'
Set-Content $vbs -Encoding ASCII -Value "CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """"$serve"""""", 0, False"

# Stop whatever serves the port now; the watchdog picks up the new build within a few seconds.
$pids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }

# Launch the watchdog outside this terminal's process tree so closing the editor doesn't kill it.
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "wscript.exe ""$vbs""" } | Out-Null

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest "http://localhost:$port/api/status" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { Write-Output "Re-ric is running at http://localhost:$port"; exit 0 }
  } catch {}
}
Write-Output "Server did not answer yet; see $root\server.log"
exit 1
