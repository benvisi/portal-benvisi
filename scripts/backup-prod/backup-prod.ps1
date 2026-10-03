<#
.SYNOPSIS
    Portal Benvisi - nightly off-platform production backup (Trello Card #34).

.DESCRIPTION
    Runs a full public-schema+data custom-format pg_dump of the production
    Supabase database via the Supavisor session pooler, validates the result
    with pg_restore -l, and only then promotes it to a final filename.
    Applies a 14-daily / 8-weekly / 12-monthly retention policy afterwards.

    This script does NOT contain the database password. Authentication is
    via PGPASSFILE, which this script sets itself (Env:PGPASSFILE) from the
    absolute $PgPassFile path below - it is not passed in through Task
    Scheduler or any other external environment configuration. See
    README.md for the exact file location, its format, and the NTFS ACL to
    apply. If that file is missing or has no matching entry, pg_dump/
    pg_restore fail fast with a clear error instead of silently prompting
    (there is no interactive session to answer a prompt when run from Task
    Scheduler).

    This script only backs up. It does not touch QA, does not modify
    production, does not run migrations, and does not reconcile schema
    drift - those are separate Card #34 slices.

    DEPLOYMENT: this file is version-controlled in the Portal Benvisi Git
    repo (on the dev terminal), but it RUNS on a separate always-on Windows
    server (logged in as BENVISI\joshua), where PostgreSQL's client tools,
    pgpass.conf, and the backup directory actually live. The Git checkout
    is the source of truth; Task Scheduler on the server invokes a deployed
    COPY at C:\PortalBenvisi\Backup\backup-prod.ps1, not this path. See
    README.md ("Two machines" / "Deployment procedure") before editing a
    copy of this file directly on the server - changes belong in Git first.

.NOTES
    Exit code 0  = backup captured, validated, and promoted.
                   (Retention/cleanup problems after a successful promotion
                   are logged as WARN/ERROR but do NOT flip this to nonzero
                   - see step 4.)
    Exit code >0 = backup itself failed; no partial/unvalidated file was
                   promoted, last_success.txt was not touched, and no
                   heartbeat ping was sent.
#>

[CmdletBinding()]
param(
    # Dry run: perform the dump + validation, but skip promotion and retention
    # deletions, and print what WOULD happen. Useful for a first supervised run.
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Non-secret configuration
# ---------------------------------------------------------------------------

$PgDumpExe    = 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
$PgRestoreExe = 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe'

$PgHostName   = 'aws-1-sa-east-1.pooler.supabase.com'   # Supavisor session pooler
$PgPort       = 5432
$PgDatabase   = 'postgres'
$PgUser       = 'postgres.ugfogsseikupsfqqznzi'

# Everything below lives OUTSIDE the Git repo working tree on purpose -
# backup artifacts and secrets must never be able to land in `git status`.
$BackupRoot     = 'C:\Users\joshua\PortalBenvisiBackups\nightly'
$StagingDir     = Join-Path $BackupRoot 'staging'
$FinalDir       = Join-Path $BackupRoot 'dumps'
$LogDir         = Join-Path $BackupRoot 'logs'
$SuccessMarker  = Join-Path $BackupRoot 'last_success.txt'

# Must be outside both the repo and $BackupRoot, ACL-restricted to the
# Windows identity running this task. This script sets Env:PGPASSFILE
# itself from this absolute path - Task Scheduler is never given the
# password or this path as a configured environment variable.
$PgPassFile     = 'C:\Users\joshua\PortalBenvisiSecrets\pgpass.conf'

# Optional dead-man's-switch heartbeat (see README.md, Option A). The URL
# itself is a bearer-token-like secret, so it is never hard-coded here -
# it is read at runtime from this file if present, and treated as disabled
# if the file is missing. Nothing is sent anywhere unless that file exists
# and contains a URL, and the URL itself is never written to any log.
$HeartbeatUrlFile = 'C:\Users\joshua\PortalBenvisiSecrets\heartbeat_url.txt'

$MinDumpBytes        = 50KB   # known-good manual dump was ~753 KB
$MinTableDataEntries = 40     # known-good manual dump had 49 TABLE DATA entries

$RetainDaily   = 14
$RetainWeekly  = 8
$RetainMonthly = 12

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

$RunStamp  = Get-Date -Format 'yyyyMMdd_HHmmss'
$LogFile   = Join-Path $LogDir "backup_$RunStamp.log"

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Level, $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

# Transient staging files (pg_dump/pg_restore stdout+stderr captures, and
# the pg_restore -l listing before it's known whether it gets promoted) for
# THIS run. Anything useful in them is written into the main persistent log
# first; the files themselves are always removed at the end of the run,
# success or failure, so staging never accumulates debris across runs.
$script:StagingArtifacts = @()

function Clear-StagingArtifacts {
    foreach ($p in $script:StagingArtifacts) {
        if ($p -and (Test-Path $p)) {
            Remove-Item $p -ErrorAction SilentlyContinue
        }
    }
}

function Fail {
    param([string]$Message)
    Write-Log $Message 'ERROR'
    Write-Log "Backup run FAILED - no file was promoted." 'ERROR'
    Clear-StagingArtifacts
    exit 1
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

foreach ($dir in @($BackupRoot, $StagingDir, $FinalDir, $LogDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

$RetentionLibPath = Join-Path $PSScriptRoot 'retention-lib.ps1'
if (-not (Test-Path $RetentionLibPath)) { Fail "retention-lib.ps1 not found at $RetentionLibPath - it must be deployed alongside backup-prod.ps1 (see README.md)." }
. $RetentionLibPath

if (-not (Test-Path $PgDumpExe))    { Fail "pg_dump.exe not found at $PgDumpExe" }
if (-not (Test-Path $PgRestoreExe)) { Fail "pg_restore.exe not found at $PgRestoreExe" }
if (-not (Test-Path $PgPassFile))   { Fail "PGPASSFILE not found at $PgPassFile - see README.md. Refusing to prompt (unattended run)." }

$env:PGPASSFILE = $PgPassFile
# Belt-and-braces: never let an interactive prompt hang an unattended run.
$env:PGPASSWORD = $null

Write-Log "=== Portal Benvisi nightly backup starting (WhatIf=$WhatIf) ==="

# ---------------------------------------------------------------------------
# 1. Dump to a temp file (never a final-looking name until validated)
# ---------------------------------------------------------------------------

$TempFile  = Join-Path $StagingDir "portal_benvisi_$RunStamp.dump.tmp"
$FinalName = "portal_benvisi_$RunStamp.dump"
$FinalFile = Join-Path $FinalDir $FinalName

Write-Log "Dumping public schema+data to staging file..."

$dumpArgs = @(
    '-h', $PgHostName,
    '-p', $PgPort,
    '-U', $PgUser,
    '-d', $PgDatabase,
    '--schema=public',
    '--no-owner', '--no-privileges', '--no-subscriptions',
    '-Fc',
    '-f', $TempFile
)

$dumpLog    = Join-Path $StagingDir "portal_benvisi_$RunStamp.pg_dump.log"
$dumpOutLog = Join-Path $StagingDir "portal_benvisi_$RunStamp.pg_dump.out.log"
$script:StagingArtifacts += $dumpLog, $dumpOutLog

$proc = Start-Process -FilePath $PgDumpExe -ArgumentList $dumpArgs `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $dumpOutLog `
    -RedirectStandardError $dumpLog

if ($proc.ExitCode -ne 0) {
    $errText = if (Test-Path $dumpLog) { Get-Content $dumpLog -Raw } else { '(no stderr captured)' }
    Write-Log "pg_dump stderr: $errText" 'ERROR'
    Remove-Item $TempFile -ErrorAction SilentlyContinue
    Fail "pg_dump exited with code $($proc.ExitCode)."
}
Write-Log "pg_dump exit code 0."

# ---------------------------------------------------------------------------
# 2. Validate: file exists, nonzero, pg_restore -l can read it
# ---------------------------------------------------------------------------

if (-not (Test-Path $TempFile)) { Fail "Dump reported success but $TempFile does not exist." }

$size = (Get-Item $TempFile).Length
Write-Log "Dump file size: $size bytes"
if ($size -lt $MinDumpBytes) {
    Remove-Item $TempFile -ErrorAction SilentlyContinue
    Fail "Dump file is only $size bytes (< $MinDumpBytes byte floor) - treating as failed/truncated."
}

Write-Log "Validating with pg_restore -l..."
$listLog = Join-Path $StagingDir "portal_benvisi_$RunStamp.pg_restore_l.log"
$listOut = Join-Path $StagingDir "portal_benvisi_$RunStamp.pg_restore_l.out"
$script:StagingArtifacts += $listLog, $listOut

$restoreProc = Start-Process -FilePath $PgRestoreExe -ArgumentList @('-l', $TempFile) `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $listOut `
    -RedirectStandardError $listLog

if ($restoreProc.ExitCode -ne 0) {
    $errText = if (Test-Path $listLog) { Get-Content $listLog -Raw } else { '(no stderr captured)' }
    Write-Log "pg_restore -l stderr: $errText" 'ERROR'
    Remove-Item $TempFile -ErrorAction SilentlyContinue
    Fail "pg_restore -l exited with code $($restoreProc.ExitCode) - dump file is not readable/valid."
}

$tableDataCount = (Select-String -Path $listOut -Pattern 'TABLE DATA').Count
Write-Log "pg_restore -l OK. TABLE DATA entries: $tableDataCount"
if ($tableDataCount -lt $MinTableDataEntries) {
    Remove-Item $TempFile -ErrorAction SilentlyContinue
    Fail "Only $tableDataCount TABLE DATA entries (< $MinTableDataEntries floor) - dump looks incomplete, refusing to promote."
}

# ---------------------------------------------------------------------------
# 3. Promote (atomic rename within the same volume)
#
#    last_success.txt and the heartbeat ping below represent exactly this:
#    a new dump was created, validated, and promoted. They are intentionally
#    independent of step 4 (retention) - a retention problem after this
#    point must never make a good backup look like a failed run.
# ---------------------------------------------------------------------------

if ($WhatIf) {
    Write-Log "[WhatIf] Would promote $TempFile -> $FinalFile"
} else {
    Move-Item -Path $TempFile -Destination $FinalFile
    # Keep the validated TOC listing as a secret-free audit sidecar next to
    # the promoted dump; it moves out of $StagingDir so cleanup below is a
    # no-op for it.
    Move-Item -Path $listOut -Destination (Join-Path $FinalDir "$FinalName.pg_restore_l.txt") -ErrorAction SilentlyContinue
    Set-Content -Path $SuccessMarker -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    Write-Log "Promoted to $FinalFile"

    $heartbeatUrl = $null
    if (Test-Path $HeartbeatUrlFile) {
        $raw = Get-Content $HeartbeatUrlFile -Raw -ErrorAction SilentlyContinue
        if ($raw) { $heartbeatUrl = $raw.Trim() }
    }

    if ($heartbeatUrl) {
        if ($heartbeatUrl -notmatch '^https?://') {
            Write-Log "Heartbeat config file present but does not look like a URL - skipping ping." 'WARN'
        } else {
            try {
                Invoke-WebRequest -Uri $heartbeatUrl -UseBasicParsing -TimeoutSec 15 | Out-Null
                Write-Log "Heartbeat ping sent."
            } catch {
                # Deliberately not logging $_.Exception.Message here: some .NET
                # HTTP exceptions echo the full request URI (which contains the
                # heartbeat token) back in their message text.
                Write-Log "Heartbeat ping failed (non-fatal) - see Windows network/DNS state if this persists." 'WARN'
            }
        }
    } else {
        Write-Log "Heartbeat disabled (no $HeartbeatUrlFile)." 'INFO'
    }
}

# ---------------------------------------------------------------------------
# 4. Retention: 14 daily / 8 weekly / 12 monthly, never delete the last copy
#
#    Wrapped so that any failure here is logged but never turns a
#    successfully-promoted backup into a failed run (exit code stays 0,
#    last_success.txt / heartbeat above are unaffected either way).
# ---------------------------------------------------------------------------

Write-Log "Applying retention policy..."

try {
    # @() forces a real array even for 0 or 1 results - see retention-lib.ps1
    # header for why this matters (PowerShell unwraps single-item pipeline
    # results into a bare scalar, which has no .Count property and caused a
    # real false-positive "would delete everything" abort in production on
    # 2026-10-01 with exactly one dump file present).
    $allDumps = @(
        Get-ChildItem -Path $FinalDir -Filter 'portal_benvisi_*.dump' | ForEach-Object {
            ConvertTo-BackupCandidate -Name $_.Name -FullName $_.FullName
        } | Where-Object { $_ }
    )

    if ($allDumps.Count -eq 0) {
        Write-Log "No dump files found for retention pass (unexpected right after a promotion)." 'WARN'
    } else {
        $retainPaths = @(Get-RetainedBackupPaths -Candidates $allDumps -RetainDaily $RetainDaily -RetainWeekly $RetainWeekly -RetainMonthly $RetainMonthly)
        $retain = New-Object System.Collections.Generic.HashSet[string]
        foreach ($p in $retainPaths) { $retain.Add($p) | Out-Null }

        $toDelete = @($allDumps | Where-Object { -not $retain.Contains($_.FullName) })

        if ($toDelete.Count -ge $allDumps.Count) {
            Write-Log "Retention logic would delete ALL files - aborting retention pass as a safety measure." 'ERROR'
        } elseif ($WhatIf) {
            foreach ($d in $toDelete) { Write-Log "[WhatIf] Would delete $($d.Name)" }
        } else {
            foreach ($d in $toDelete) {
                Remove-Item $d.FullName -ErrorAction SilentlyContinue
                $sidecar = "$($d.FullName).pg_restore_l.txt"
                Remove-Item $sidecar -ErrorAction SilentlyContinue
                Write-Log "Deleted (outside 14d/8w/12m retention): $($d.Name)"
            }
            Write-Log "Retained $($retain.Count) of $($allDumps.Count) dump files."
        }
    }
} catch {
    Write-Log "Retention pass failed with an exception (backup itself is unaffected): $($_.Exception.Message)" 'ERROR'
}

Clear-StagingArtifacts

Write-Log "=== Backup run completed successfully ==="
exit 0
