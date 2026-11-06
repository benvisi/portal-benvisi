<#
.SYNOPSIS
  Runs the stock-prioritized product-image batch (`node src/lote.mjs`) and logs it.

.DESCRIPTION
  SAFE BY DEFAULT: without -Persist it only prints the selection (no browser,
  no AI call, no database write). With -Persist it acquires candidates from
  Lacoste (headed Chromium) and scores them with Anthropic into the review
  queue. It never approves, rejects or publishes anything.

  Output goes to %LOCALAPPDATA%\PortalBenvisi\logs\lote-YYYYMMDD.log (live).
  The run must start from the logged-in Windows desktop session (headed
  Chromium needs it); it keeps running if you close the window that started it,
  but NOT if you log off, sleep or shut down. A second run while one is active
  exits immediately (lock file), so it is safe to start twice.

  Exit codes: 0 ok / nothing to do, 1 worker error (see log), 124 time limit,
  130 interrupted, 3 wrapper problem.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File run-lote.ps1            # dry-run
  powershell -NoProfile -ExecutionPolicy Bypass -File run-lote.ps1 -Persist -Limit 25
#>
[CmdletBinding()]
param(
  [switch]$Persist,
  [ValidateRange(1, 100)][int]$Limit = 25,
  [ValidateRange(1, 600)][double]$MaxMinutes = 150,
  [string]$LogDir = $(if ($env:PUBLICAR_LOG_DIR) { $env:PUBLICAR_LOG_DIR } else { Join-Path $env:LOCALAPPDATA 'PortalBenvisi\logs' })
)

$ErrorActionPreference = 'Stop'
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mode = if ($Persist) { 'PERSIST' } else { 'dry-run' }

try {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $log = Join-Path $LogDir ('lote-{0}.log' -f (Get-Date).ToString('yyyyMMdd'))
  $node = (Get-Command node -ErrorAction Stop).Source

  Add-Content -LiteralPath $log -Encoding UTF8 -Value ('{0} === start mode={1} limit={2} user={3}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $mode, $Limit, $env:USERNAME)

  $flags = "--limit=$Limit"
  if ($Persist) { $flags += ' --persist' }
  # cmd handles the redirection so the log fills live and survives this window closing.
  $proc = Start-Process -FilePath 'cmd.exe' -WorkingDirectory $workerDir -PassThru -WindowStyle Hidden `
    -ArgumentList '/c', ('""{0}" src\lote.mjs {1} >> "{2}" 2>&1"' -f $node, $flags, $log)
  $null = $proc.Handle
  if ($proc.WaitForExit([int]($MaxMinutes * 60 * 1000))) {
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode
  } else {
    & taskkill.exe /PID $proc.Id /T /F | Out-Null
    $exitCode = 124
    Add-Content -LiteralPath $log -Encoding UTF8 -Value "TIME LIMIT ($MaxMinutes min) exceeded; process tree killed. Re-run to resume."
  }
  Add-Content -LiteralPath $log -Encoding UTF8 -Value ('{0} === end mode={1} exit={2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $mode, $exitCode)
  exit $exitCode
} catch {
  Write-Host "WRAPPER ERROR: $($_.Exception.Message)"
  exit 3
}
