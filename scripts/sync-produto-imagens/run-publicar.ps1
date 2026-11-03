<#
.SYNOPSIS
  Task Scheduler wrapper for the product-image publication worker (Trello #10).

.DESCRIPTION
  Runs `node src/publish.mjs` from the worker folder, appends timestamped
  output and the exit code to a daily log, enforces an outer time limit
  (killing the whole process tree, including Chromium), and prunes old logs.

  SAFE BY DEFAULT: without -Persist it runs the read-only dry-run. Publication
  (uploads + activation) happens only with -Persist.

  Exit codes are the worker's: 0 ok / nothing to do / another run active,
  1 run-level error, 2 at least one publication failed (recorded and retried
  with backoff), 124 time limit, 130/143 interrupted. 3 = wrapper problem.

  Configuration (parameter, else environment variable, else default):
    -WorkerDir  PUBLICAR_WORKER_DIR  folder containing src/publish.mjs and .env
                                     (default: the folder of this script)
    -LogDir     PUBLICAR_LOG_DIR     (default: %LOCALAPPDATA%\PortalBenvisi\logs)
    -NodePath   PUBLICAR_NODE        (default: node found on PATH)
    -MaxMinutes                      outer limit; keep it above the worker's own
                                     PUBLICAR_MAX_RUNTIME_MIN (default 20)
  The worker itself also reads PUBLICAR_MAX_RUNTIME_MIN, PUBLICAR_ITEM_TIMEOUT_SEC
  and PUBLICAR_LOCK_FILE, plus SUPABASE_* from its .env.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File run-publicar.ps1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File run-publicar.ps1 -Persist
#>
[CmdletBinding()]
param(
  [switch]$Persist,
  [string]$WorkerDir = $env:PUBLICAR_WORKER_DIR,
  [string]$LogDir = $(if ($env:PUBLICAR_LOG_DIR) { $env:PUBLICAR_LOG_DIR } else { Join-Path $env:LOCALAPPDATA 'PortalBenvisi\logs' }),
  [string]$NodePath = $env:PUBLICAR_NODE,
  [ValidateRange(0.1, 240)][double]$MaxMinutes = 25,
  [ValidateRange(1, 20)][int]$Limit = 5,
  [ValidateRange(1, 365)][int]$KeepDays = 30
)

$ErrorActionPreference = 'Stop'
if (-not $WorkerDir) { $WorkerDir = Split-Path -Parent $MyInvocation.MyCommand.Path } # $PSScriptRoot is empty in param defaults on PS 5.1
$mode = if ($Persist) { 'PERSIST' } else { 'dry-run' }
$script:LogFile = $null

function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
  if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 }
  Write-Host $line
}

try {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $script:LogFile = Join-Path $LogDir ('publicar-{0}.log' -f (Get-Date).ToString('yyyyMMdd'))

  if (-not $NodePath) { $NodePath = (Get-Command node -ErrorAction Stop).Source }
  if (-not (Test-Path -LiteralPath (Join-Path $WorkerDir 'src\publish.mjs'))) {
    throw "src\publish.mjs not found in WorkerDir '$WorkerDir'"
  }

  Write-Log "=== start mode=$mode limit=$Limit worker=$WorkerDir node=$NodePath maxMinutes=$MaxMinutes user=$env:USERNAME"

  $outFile = [IO.Path]::GetTempFileName()
  $errFile = [IO.Path]::GetTempFileName()
  $arguments = @('src/publish.mjs', "--limit=$Limit")
  if ($Persist) { $arguments += '--persist' }

  $proc = Start-Process -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory $WorkerDir `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru -NoNewWindow
  $null = $proc.Handle # cache the handle, otherwise ExitCode can read as empty
  $finished = $proc.WaitForExit([int]($MaxMinutes * 60 * 1000))

  if ($finished) {
    $proc.WaitForExit() # flush redirected streams and finalize ExitCode
    $exitCode = $proc.ExitCode
  } else {
    Write-Log "TIME LIMIT ($MaxMinutes min) exceeded; killing process tree pid=$($proc.Id)"
    & taskkill.exe /PID $proc.Id /T /F | Out-Null
    $exitCode = 124
  }

  foreach ($pair in @(@('out', $outFile), @('err', $errFile))) {
    if (Test-Path -LiteralPath $pair[1]) {
      Get-Content -LiteralPath $pair[1] -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "[$($pair[0])] $_" }
      Remove-Item -LiteralPath $pair[1] -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Log "=== end mode=$mode exit=$exitCode"

  Get-ChildItem -LiteralPath $LogDir -Filter 'publicar-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  exit $exitCode
} catch {
  Write-Log "WRAPPER ERROR: $($_.Exception.Message)"
  exit 3
}
