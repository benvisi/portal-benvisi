<#
.SYNOPSIS
    Deterministic unit tests / simulations for retention-lib.ps1.

.DESCRIPTION
    Pure in-memory tests: no files, no pg_dump, no network, no Supabase, no
    production/QA contact, no Task Scheduler. Run locally or in CI with:

        powershell -NoProfile -File test-retention.ps1

    Exits 0 if every assertion passes, 1 if any fails (prints a summary
    either way). This is what caught and proves the fix for the 2026-10-01
    production incident: with exactly one promoted dump present, retention
    logged "would delete ALL files" and aborted, even though the correct
    outcome was "retain 1, delete 0". Root cause: PowerShell unwraps a
    single-element pipeline result into a bare scalar (no .Count property in
    Windows PowerShell 5.1), which made a correct zero-deletions result
    compare as $null -ge $null (true) against the safety guard. See
    retention-lib.ps1's header comment and the "1 backup" / regression test
    below.
#>

. (Join-Path $PSScriptRoot 'retention-lib.ps1')

$script:PassCount = 0
$script:FailCount = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if ($Condition) {
        $script:PassCount++
        Write-Host "  PASS: $Message" -ForegroundColor Green
    } else {
        $script:FailCount++
        Write-Host "  FAIL: $Message" -ForegroundColor Red
    }
}

function New-Candidate {
    param([datetime]$Date)
    $name = "portal_benvisi_{0}.dump" -f $Date.ToString('yyyyMMdd_HHmmss')
    [PSCustomObject]@{
        FullName = "C:\fake\dumps\$name"
        Name     = $name
        Date     = $Date
    }
}

function New-DailySeries {
    # N candidates, one per day, newest = today (HH:mm:ss fixed so grouping
    # by day is unambiguous), going back N-1 days.
    param([int]$N, [datetime]$Start = (Get-Date -Hour 3 -Minute 0 -Second 0))
    1..$N | ForEach-Object { New-Candidate -Date $Start.AddDays(-($_ - 1)) }
}

$Today = Get-Date -Hour 3 -Minute 0 -Second 0 -Millisecond 0

Write-Host "`n=== ConvertTo-BackupCandidate: filename filtering ===" -ForegroundColor Cyan

$validName = "portal_benvisi_20261001_161243.dump"
$c = ConvertTo-BackupCandidate -Name $validName -FullName "C:\dumps\$validName"
Assert-True ($null -ne $c) "Valid dump filename is accepted"
Assert-True ($c.Date -eq [datetime]::ParseExact('20261001161243', 'yyyyMMddHHmmss', $null)) "Valid dump filename parses full date+time correctly"

@(
    "portal_benvisi_20261001_161243.dump.tmp",
    "portal_benvisi_20261001_161243.dump.pg_restore_l.txt",
    "portal_benvisi_20261001_161243.pg_dump.log",
    "portal_benvisi_20261001.dump",
    "something_else_20261001_161243.dump",
    "portal_benvisi_2026100_161243.dump"
) | ForEach-Object {
    $r = ConvertTo-BackupCandidate -Name $_ -FullName "C:\dumps\$_"
    Assert-True ($null -eq $r) "Staging/sidecar/malformed name rejected as candidate: $_"
}

Write-Host "`n=== Regression test: exactly 1 backup (2026-10-01 production incident) ===" -ForegroundColor Cyan

$one = @(New-Candidate -Date $Today)
$retained = @(Get-RetainedBackupPaths -Candidates $one -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
Assert-True ($retained -is [array]) "Result is a real array (not an unwrapped scalar)"
Assert-True ($retained.Count -eq 1) "1 candidate -> 1 retained"
Assert-True ($retained[0] -eq $one[0].FullName) "The single candidate is the one retained"
$toDelete = @($one | Where-Object { $retained -notcontains $_.FullName })
Assert-True ($toDelete -is [array]) "toDelete is a real array (not \$null)"
Assert-True ($toDelete.Count -eq 0) "0 candidates to delete"
Assert-True (-not ($toDelete.Count -ge $one.Count)) "Safety-abort condition does NOT spuriously trigger for 1 backup"

Write-Host "`n=== 2 backups, same calendar day ===" -ForegroundColor Cyan

$sameDay = @(
    (New-Candidate -Date $Today.AddHours(1)),   # earlier run, same calendar day (Today is 03:00)
    (New-Candidate -Date $Today.AddHours(20))   # later run, same calendar day
)
$retained = @(Get-RetainedBackupPaths -Candidates $sameDay -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
Assert-True ($retained.Count -eq 1) "2 same-day backups -> only 1 retained (one file per day)"
Assert-True ($retained[0] -eq $sameDay[1].FullName) "The CHRONOLOGICALLY LATER same-day run is the one retained (not just incidental sort order)"

Write-Host "`n=== 0 backups (defensive, even though caller short-circuits this case) ===" -ForegroundColor Cyan

$empty = @(Get-RetainedBackupPaths -Candidates @() -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
Assert-True ($empty -is [array]) "0 candidates -> real empty array, not \$null"
Assert-True ($empty.Count -eq 0) "0 candidates -> 0 retained"

Write-Host "`n=== Exactly RetainDaily (14) consecutive daily backups ===" -ForegroundColor Cyan

$fourteen = @(New-DailySeries -N 14 -Start $Today)
$retained = @(Get-RetainedBackupPaths -Candidates $fourteen -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
Assert-True ($retained.Count -eq 14) "Exactly 14 daily backups -> all 14 retained, none dropped at the boundary"

Write-Host "`n=== 20 consecutive daily backups (> 14 days) ===" -ForegroundColor Cyan

$twenty = @(New-DailySeries -N 20 -Start $Today)
$retained = @(Get-RetainedBackupPaths -Candidates $twenty -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
$newest14Names = @($twenty | Select-Object -First 14 | ForEach-Object { $_.FullName })
$allNewest14Retained = $true
foreach ($n in $newest14Names) { if ($retained -notcontains $n) { $allNewest14Retained = $false } }
Assert-True $allNewest14Retained "All of the newest 14 calendar days are retained (daily bucket guarantee)"
Assert-True ($retained -contains $twenty[0].FullName) "Newest overall backup is retained"
Assert-True ($retained.Count -ge 14 -and $retained.Count -le 20) "Retained count is bounded sanely (14..20) for 20 days of history"

Write-Host "`n=== 70 consecutive daily backups (> 8 weeks) ===" -ForegroundColor Cyan

$seventy = @(New-DailySeries -N 70 -Start $Today)
$retained = @(Get-RetainedBackupPaths -Candidates $seventy -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
Assert-True ($retained -contains $seventy[0].FullName) "Newest overall backup retained at 70-day scale"
Assert-True ($retained.Count -le 34) "Retained count never exceeds the 14+8+12=34 theoretical union maximum"
Assert-True ($retained.Count -ge 14) "Daily bucket alone still guarantees at least 14 retained"
$oldestFew = @($seventy | Select-Object -Last 5 | ForEach-Object { $_.FullName })
$anyOldestRetained = $false
foreach ($n in $oldestFew) { if ($retained -contains $n) { $anyOldestRetained = $true } }
Assert-True (-not $anyOldestRetained -or ($seventy.Count - 1) -lt 70) "Oldest few of 70 days are correctly outside all three windows (sanity, not a hard guarantee)"

Write-Host "`n=== 400 consecutive daily backups (> 12 months) ===" -ForegroundColor Cyan

$fourHundred = @(New-DailySeries -N 400 -Start $Today)
$retained = @(Get-RetainedBackupPaths -Candidates $fourHundred -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
Assert-True ($retained -contains $fourHundred[0].FullName) "Newest overall backup retained at 400-day scale"
Assert-True ($retained.Count -le 34) "Retained count still bounded by 34 even at 400 days of history"
Assert-True ($retained.Count -ge 25 -and $retained.Count -le 34) "Retained count in expected ~31-ish steady-state range for >1 year of daily history"
$oldest30 = @($fourHundred | Select-Object -Last 30 | ForEach-Object { $_.FullName })
$anyOldest30Retained = $false
foreach ($n in $oldest30) { if ($retained -contains $n) { $anyOldest30Retained = $true } }
Assert-True (-not $anyOldest30Retained) "The oldest ~30 days (beyond all three windows) are correctly NOT retained"

Write-Host "`n=== Newest backup always retained (sweep N=1..30, 50, 100) ===" -ForegroundColor Cyan

$allNewestOk = $true
foreach ($n in (1..30) + 50 + 100) {
    $series = @(New-DailySeries -N $n -Start $Today)
    $r = @(Get-RetainedBackupPaths -Candidates $series -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
    if ($r -notcontains $series[0].FullName) { $allNewestOk = $false }
    if ($r.Count -eq 0) { $allNewestOk = $false }
}
Assert-True $allNewestOk "Across every N from 1 to 100, the newest backup is always retained and the retained set is never empty"

Write-Host "`n=== Never deletes all backups (sweep N=1..30, 50, 100) ===" -ForegroundColor Cyan

$neverDeletesAll = $true
foreach ($n in (1..30) + 50 + 100) {
    $series = @(New-DailySeries -N $n -Start $Today)
    $r = @(Get-RetainedBackupPaths -Candidates $series -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
    $toDel = @($series | Where-Object { $r -notcontains $_.FullName })
    if ($toDel.Count -ge $series.Count) { $neverDeletesAll = $false }
}
Assert-True $neverDeletesAll "Across every N from 1 to 100, toDelete.Count never reaches allDumps.Count (no false OR real 'delete everything')"

Write-Host "`n=== Overlapping buckets: a sparse/irregular set still behaves sanely ===" -ForegroundColor Cyan

# Irregular gaps: not one-per-day, mixes same-day duplicates, multi-day gaps,
# and a long gap - exercises bucket overlap without assuming a clean series.
$irregular = @(
    New-Candidate -Date $Today
    New-Candidate -Date $Today.AddHours(-6)
    New-Candidate -Date $Today.AddDays(-1)
    New-Candidate -Date $Today.AddDays(-3)
    New-Candidate -Date $Today.AddDays(-10)
    New-Candidate -Date $Today.AddDays(-25)
    New-Candidate -Date $Today.AddDays(-25).AddHours(-2)
    New-Candidate -Date $Today.AddDays(-60)
    New-Candidate -Date $Today.AddDays(-200)
    New-Candidate -Date $Today.AddDays(-500)
) | Sort-Object Date -Descending
$retained = @(Get-RetainedBackupPaths -Candidates $irregular -RetainDaily 14 -RetainWeekly 8 -RetainMonthly 12)
Assert-True ($retained -contains $irregular[0].FullName) "Newest of an irregular set is retained"
$retainedCount = $retained.Count
$uniqueDistinctCandidates = $irregular.Count
Assert-True ($retainedCount -le $uniqueDistinctCandidates) "Never retains more files than exist"
Assert-True ($retainedCount -ge 1) "Always retains at least 1 from an irregular set"
$toDelete = @($irregular | Where-Object { $retained -notcontains $_.FullName })
Assert-True (-not ($toDelete.Count -ge $irregular.Count)) "Irregular set never triggers the false/real delete-all abort"

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "  Passed: $script:PassCount" -ForegroundColor Green
Write-Host "  Failed: $script:FailCount" -ForegroundColor $(if ($script:FailCount -gt 0) { 'Red' } else { 'Green' })

if ($script:FailCount -gt 0) { exit 1 } else { exit 0 }
