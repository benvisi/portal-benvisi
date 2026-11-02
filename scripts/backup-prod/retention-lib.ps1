<#
.SYNOPSIS
    Pure, side-effect-free backup-candidate filtering and retention-selection
    logic, factored out of backup-prod.ps1 so it can be unit-tested
    (test-retention.ps1) without needing real files, pg_dump, or network
    access. No file I/O, no network calls, no $env: reads in this file.

.DESCRIPTION
    Dot-sourced by backup-prod.ps1 (which must deploy this file alongside it
    - see README.md "Deployment procedure") and by test-retention.ps1.

    Everything here deliberately wraps pipeline results in @(...) and avoids
    any bare array indexing on a pipeline result before it has been forced
    into a real array. This guards against a real Windows PowerShell 5.1/7
    behavior: a pipeline (or Where-Object/Group-Object output) that happens
    to produce exactly one object is auto-unwrapped into a bare scalar
    instead of a one-element array. That scalar has no .Count property
    (silently $null in Windows PowerShell 5.1, not an error), which can make
    a correct "0 to delete" result compare as "$null -ge $null" (true) and
    falsely trip a safety guard meant for the opposite condition. @(...)
    around every pipeline assignment used in a .Count or [0] comparison
    eliminates this class of bug structurally, for any N (0, 1, 2, ...).
#>

$script:BackupFileNamePattern = '^portal_benvisi_(\d{8})_(\d{6})\.dump$'

function ConvertTo-BackupCandidate {
    <#
    .SYNOPSIS
        Returns a candidate object {FullName; Name; Date} for a promoted
        backup filename, or $null for anything else.

    .DESCRIPTION
        $Name must match exactly portal_benvisi_YYYYMMDD_HHMMSS.dump - this
        is what keeps staging .tmp files, .pg_restore_l.txt audit sidecars,
        and any other file that might end up in the dumps directory from
        ever being treated as an independent backup candidate by retention.

        Date carries the FULL parsed timestamp (date + time), not just the
        date - this matters for same-day duplicates: the representative
        chosen for a day/week/month bucket must be the chronologically
        latest run, not whichever file happens to sort first when ties on
        a date-only value are broken by incidental pipeline order.
    #>
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$FullName
    )
    if ($Name -match $script:BackupFileNamePattern) {
        [PSCustomObject]@{
            FullName = $FullName
            Name     = $Name
            Date     = [datetime]::ParseExact("$($Matches[1])$($Matches[2])", 'yyyyMMddHHmmss', $null)
        }
    } else {
        $null
    }
}

function Get-RetainedBackupPaths {
    <#
    .SYNOPSIS
        Given backup candidates and the three retention window sizes,
        returns the FullName values to RETAIN. The complement (candidates
        not in this list) is what the caller should delete.

    .DESCRIPTION
        - Always returns a real string[] array, even for 0 or 1 candidates
          (never $null, never an unwrapped scalar) - callers can safely use
          .Count and .Contains(...) on the result without the scalar-
          collapse bug described in this file's header.
        - Always includes the single chronologically newest candidate, if
          any candidates were given at all, regardless of what the daily/
          weekly/monthly bucket math computes - this is the hard safety net
          against ever retaining zero backups.
        - Daily/weekly/monthly buckets are a union (a candidate retained by
          any one bucket is retained), each capped at $RetainDaily /
          $RetainWeekly / $RetainMonthly distinct calendar days / ISO weeks
          / calendar months respectively, keeping the chronologically latest
          candidate within each kept bucket as that bucket's representative.
    #>
    param(
        [AllowEmptyCollection()][object[]]$Candidates,
        [Parameter(Mandatory)][int]$RetainDaily,
        [Parameter(Mandatory)][int]$RetainWeekly,
        [Parameter(Mandatory)][int]$RetainMonthly
    )

    $all = @($Candidates | Sort-Object Date -Descending)
    if ($all.Count -eq 0) { return [string[]]@() }

    $retain = New-Object System.Collections.Generic.HashSet[string]

    function Add-BucketRepresentatives {
        param($Groups, [int]$Keep)
        @($Groups | Select-Object -First $Keep) | ForEach-Object {
            $rep = @($_.Group | Sort-Object Date -Descending)[0]
            $retain.Add($rep.FullName) | Out-Null
        }
    }

    $byDay = @($all | Group-Object { $_.Date.ToString('yyyy-MM-dd') } | Sort-Object Name -Descending)
    Add-BucketRepresentatives -Groups $byDay -Keep $RetainDaily

    $byWeek = @($all | Group-Object {
        $cal  = [System.Globalization.CultureInfo]::InvariantCulture.Calendar
        $rule = [System.Globalization.CalendarWeekRule]::FirstFourDayWeek
        $dow  = [System.DayOfWeek]::Monday
        "{0}-W{1:D2}" -f $_.Date.Year, $cal.GetWeekOfYear($_.Date, $rule, $dow)
    } | Sort-Object Name -Descending)
    Add-BucketRepresentatives -Groups $byWeek -Keep $RetainWeekly

    $byMonth = @($all | Group-Object { $_.Date.ToString('yyyy-MM') } | Sort-Object Name -Descending)
    Add-BucketRepresentatives -Groups $byMonth -Keep $RetainMonthly

    # Hard safety net: always keep at least the single newest candidate,
    # independent of whatever the bucket math above computed.
    $retain.Add($all[0].FullName) | Out-Null

    return [string[]]@($retain)
}
