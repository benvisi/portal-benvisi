# Portal Benvisi — nightly off-platform production backup

Trello Card #34 (Supabase resilience). This is the **backup** slice only —
schema baseline/drift reconciliation and restore automation are separate
slices.

Produces a nightly full `public`-schema custom-format `pg_dump` of
production, validated with `pg_restore -l`, promoted atomically, and kept
under a 14-daily / 8-weekly / 12-monthly retention policy — on the always-on
Windows server, no cloud infra.

## Two machines, two roles

This setup spans **two separate Windows machines** — don't assume paths on
one apply to the other:

| | Dev terminal | Always-on server |
|---|---|---|
| Logged in as | (this session) | `BENVISI\joshua` |
| Role | Canonical/version-controlled source | Where the backup actually runs |
| Has | Git repo, OneDrive-synced `Documentos\GitHub\portal-benvisi\` | PostgreSQL 17 client tools, `pgpass.conf`, the backup directory, Task Scheduler |
| `backup-prod.ps1` + `retention-lib.ps1` live at | `scripts\backup-prod\` in this repo (Git-tracked) | `C:\PortalBenvisi\Backup\` (deployed copies, **not** Git-tracked, **not** OneDrive-synced) |

**`retention-lib.ps1` must be deployed alongside `backup-prod.ps1`, not just
`backup-prod.ps1` alone** — `backup-prod.ps1` dot-sources it at startup
(`. (Join-Path $PSScriptRoot 'retention-lib.ps1')`) and fails fast with a
clear error if it's missing. `test-retention.ps1` (the deterministic test
suite for the retention logic, dev-terminal-only, never needs to run on the
server) also dot-sources it.

Task Scheduler, `pgpass.conf`, `heartbeat_url.txt`, and the dump/log/staging
directories all belong to the **server**, under the `joshua` account there —
none of that exists on, or should be configured from, the dev terminal. The
dev terminal's job is authoring and version-controlling the script; the
server's job is running it. See "Deployment procedure" below for how a
change moves from one to the other.

## Status

- [x] `backup-prod.ps1` written, reviewed, and revised per review feedback
      (staging cleanup, non-fatal retention, externalized heartbeat URL,
      `RemoteSigned`)
- [x] Two-machine deployment path documented (`C:\PortalBenvisi\Backup\`)
- [x] Canonical script + `pgpass.conf` deployed to the server by Joshua
- [x] **First real supervised production backup run — 2026-10-01, PASSED**
      (`pg_dump` exit 0, 778607 bytes, `pg_restore -l` PASS, 49 TABLE DATA
      entries, promoted, `last_success.txt` updated, process exit 0)
- [x] **Retention bug found on that same run, root-caused, fixed, and
      covered by a 36-assertion regression test suite** — see "Retention
      bug (2026-10-01)" below. **Not yet redeployed to the server.**
- [x] `retention-lib.ps1` (new file, required by the fix) copied to the
      server alongside the corrected `backup-prod.ps1`
- [ ] `heartbeat_url.txt` created, on the server, only if you choose
      dead-man's-switch Option A (**Joshua — manual**, optional)
- [ ] NTFS ACLs applied to secrets + backup folders, on the server (**Joshua — manual**)
- [x] Scheduled Task registered, on the server
- [x] **First unattended (Task-Scheduler-driven, not manually invoked) run —
      2026-10-02 02:00, PASSED** (`portal_benvisi_20261002_020000.dump`,
      781083 bytes, 49 TABLE DATA entries)
- [x] **First restore rehearsal — 2026-10-03, PASSED**, restoring that exact
      unattended artifact into the separate QA Supabase project. Found and
      resolved a real restore-time gap (the `citext` extension) not visible
      from the backup side alone — see "Restore procedure" below for the
      full rehearsed procedure and acceptance evidence.

This revision (the retention fix) has not been copied to the server and has
not touched production, QA, or Task Scheduler — see "Retention bug
(2026-10-01)" for exactly what was changed and how it was verified.

### Retention bug (2026-10-01)

**Symptom:** immediately after the 2026-10-01 production backup promoted
successfully (everything above passed), the retention pass logged
`[ERROR] Retention logic would delete ALL files - aborting retention pass
as a safety measure` with exactly one dump file present. The safety guard
did its job — nothing was deleted — but it fired on a false alarm; the
correct outcome was "retain 1, delete 0," no error.

**Root cause:** Windows PowerShell silently unwraps a single-element
pipeline result into a bare scalar object instead of a one-element array.
With exactly one dump file, the candidate list collapsed to a scalar, which
has no `.Count` property (silently `$null` in Windows PowerShell 5.1,
rather than an error). When the "nothing to delete" result then also
collapsed to `$null`, the safety check `$toDelete.Count -ge $allDumps.Count`
evaluated as `$null -ge $null`, which PowerShell treats as `$true` —
tripping the guard on a dataset where zero deletions were actually correct.

**Fix:** extracted the candidate-filtering and retention-selection logic
into `retention-lib.ps1` (new file, dot-sourced by `backup-prod.ps1`,
side-effect-free so it's independently testable), wrapping every pipeline
result that feeds a `.Count` check or `[0]` index in `@(...)` to force a
real array regardless of how many elements it contains — this eliminates
the whole bug class structurally, for any N, not just N=1. While building
test cases for "2 backups same day," also found and fixed a related
precision gap: the original code grouped by date-only, discarding the
embedded run time, so "retain the latest same-day run" wasn't actually
guaranteed by the code (only by incidental sort-order luck); candidates now
carry the full parsed timestamp. See `test-retention.ps1` for the full
36-assertion suite (all passing) and retention-lib.ps1's header comment for
the detailed mechanism.

### Static validation performed

Every revision of `backup-prod.ps1` and `retention-lib.ps1` is checked with
(read-only, no execution of the dump/promote/retention logic itself — no
file writes under `PortalBenvisiBackups`, no network calls, no Supabase
contact; run on the dev terminal since that's where the canonical copy
lives — syntax parsing is identical regardless of machine, but a real run
should still happen on the server after each deploy, since that's the only
place `pg_dump.exe`/`pgpass.conf` exist):

- `[System.Management.Automation.Language.Parser]::ParseFile(...)` on both
  files — 0 syntax errors
- The same check re-run inside a freshly spawned `powershell.exe -NoProfile`
  process — 0 syntax errors
- `Get-Command backup-prod.ps1 -Syntax` — correctly resolves to
  `backup-prod.ps1 [-WhatIf] [<CommonParameters>]`
- `test-retention.ps1` (pure in-memory, dev-terminal-only) — 36/36
  assertions pass, see "Retention bug (2026-10-01)" above

This caught and fixed a real bug: the file (no UTF-8 BOM) contained em-dash
characters that Windows PowerShell 5.1 mis-decodes under its default,
non-UTF-8 file-encoding behavior for BOM-less scripts — that was actually
producing an "unterminated string" parse failure, which would have made the
script fail to run at all under Task Scheduler (on either machine — this
was a property of the file's bytes, not of which machine runs it). Fixed by
replacing every em-dash with a plain ASCII ` - ` throughout the script, so
the file is pure ASCII and immune to this class of encoding issue
regardless of how it's saved/edited/re-encoded/copied between machines in
the future. `PSScriptAnalyzer` was not run (not installed, and installing
it wasn't in scope for this review-only pass).

## 1. Where things live

| What | Location | Machine | In Git? |
|---|---|---|---|
| Canonical script | `scripts/backup-prod/backup-prod.ps1` | Dev terminal (this repo) | Yes |
| Canonical retention library (dot-sourced by the script above) | `scripts/backup-prod/retention-lib.ps1` | Dev terminal (this repo) | Yes |
| Canonical retention test suite (dev-only, never needs the server) | `scripts/backup-prod/test-retention.ps1` | Dev terminal (this repo) | Yes |
| Deployed script (what Task Scheduler runs) | `C:\PortalBenvisi\Backup\backup-prod.ps1` | Server | No — a copy, see "Deployment procedure" |
| Deployed retention library (**required**, script fails fast without it) | `C:\PortalBenvisi\Backup\retention-lib.ps1` | Server | No — a copy, see "Deployment procedure" |
| Password | `C:\Users\joshua\PortalBenvisiSecrets\pgpass.conf` | Server | No — outside repo entirely |
| Heartbeat ping URL (optional) | `C:\Users\joshua\PortalBenvisiSecrets\heartbeat_url.txt` | Server | No — outside repo entirely |
| Dumps | `C:\Users\joshua\PortalBenvisiBackups\nightly\dumps\` | Server | No — outside repo entirely |
| Staging (transient, self-cleaning) | `C:\...\nightly\staging\` | Server | No |
| Logs | `C:\...\nightly\logs\` | Server | No |
| Success marker (dead-man's-switch input) | `C:\...\nightly\last_success.txt` | Server | No |

Secrets and backup artifacts are placed **outside the Git working tree on
purpose** — not just gitignored, but on a different machine entirely from
the one running Git — so there is no configuration mistake that could ever
put a password or a dump containing employee PIN-related data into
`git status`, and no OneDrive sync could ever pick them up either.

## 2. Deployment procedure (dev terminal → server)

The Git repo is the **only** canonical source. The server's copy is a
plain, disposable file copy — if it's ever in doubt, re-copy it from Git,
don't hand-edit it on the server.

1. On the dev terminal, make and commit changes to
   `scripts/backup-prod/backup-prod.ps1` and/or `retention-lib.ps1` in the
   normal Git workflow (review, commit, push — not part of this slice's
   authority, but the normal process going forward). If you only change the
   test suite, there's nothing to deploy — `test-retention.ps1` never runs
   on the server.
2. Copy **both** `backup-prod.ps1` and `retention-lib.ps1` to the server, to
   `C:\PortalBenvisi\Backup\` (same folder, both files — `backup-prod.ps1`
   dot-sources `retention-lib.ps1` from its own folder via `$PSScriptRoot`
   and fails fast at startup if the library is missing, rather than running
   with stale or absent retention logic). Any mechanism that preserves
   plain-text content is fine — RDP clipboard copy-paste, a mapped/shared
   drive, `Copy-Item` over a PS remoting session, or even re-typing the
   `git show` output by hand for a one-off. There's nothing server-specific
   baked into either file (no dev-terminal paths — see "Static validation
   performed"), so a byte-for-byte copy is always correct.
3. On the server, re-run the same static validation on both files before
   trusting the deployed copies to Task Scheduler:
   ```powershell
   foreach ($p in "C:\PortalBenvisi\Backup\backup-prod.ps1","C:\PortalBenvisi\Backup\retention-lib.ps1") {
       $e = $null
       [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$e)
       if ($e.Count -eq 0) { "PARSE OK: $p" } else { "ERRORS in $p"; $e }
   }
   ```
4. Run `C:\PortalBenvisi\Backup\backup-prod.ps1 -WhatIf` once on the server
   (see "First run" below) before registering/updating the Scheduled Task.

There is deliberately no automated sync (no scheduled `git pull` on the
server, no CI deploy step) for this slice — the backup script changes
rarely, and an explicit manual copy keeps "what Task Scheduler is actually
running" always a deliberate, reviewable action rather than something that
could change underneath a 2am job unattended.

## 3. Credential handling — `pgpass.conf`

**Evaluated and recommended: standard PostgreSQL `pgpass.conf`.** This is
the documented mechanism for unattended `pg_dump`/`psql` authentication and
is what Supabase's own docs point to for scripted/CI use. The alternative
(`PGPASSWORD` env var set directly in the Scheduled Task) would put the
password in the Task Scheduler configuration itself, readable by anyone who
can view the task — `pgpass.conf` with a tight ACL is strictly better.

**Exact location (on the server):** `C:\Users\joshua\PortalBenvisiSecrets\pgpass.conf`

Not the PostgreSQL default (`%APPDATA%\Roaming\postgresql\pgpass.conf`) —
the script itself sets `Env:PGPASSFILE` to this exact absolute path at
startup (see `backup-prod.ps1`, "Setup" section). **This value is not, and
should not be, configured anywhere in Task Scheduler** — not as an
environment variable on the action, not in the Arguments field. Task
Scheduler only ever launches `powershell.exe -File backup-prod.ps1`; the
script is entirely self-contained for pointing at its own credential file,
which keeps the dependency visible and auditable in one place (the
committed script) rather than split across a Task Scheduler configuration
that isn't version-controlled.

**Exact entry format** (one line, colon-separated; `*` is a valid wildcard
but here every field should be the literal value so a typo in host/user
can't accidentally match):

```
aws-1-sa-east-1.pooler.supabase.com:5432:postgres:postgres.ugfogsseikupsfqqznzi:THE_ACTUAL_PASSWORD
```

Notes:
- If the password itself contains `:` or `\`, escape them as `\:` and `\\`.
- The file must contain **only** this line (plus optionally a trailing
  newline). No header, no other credentials.
- `pg_dump`/`pg_restore` silently refuse to use the file if its permissions
  are too open — which is also a built-in correctness check that the ACL
  step (below) was done right.

**Joshua creates this file himself, on the server** (Notepad or
`Set-Content`, typed interactively — not pasted through Claude, not through
PowerShell history if you're careful to open Notepad rather than doing it
inline on the command line).

## 4. NTFS ACL strategy (proposed — not applied)

All of this is **on the server**. Apply to **both**
`C:\Users\joshua\PortalBenvisiSecrets\` (password) and
`C:\Users\joshua\PortalBenvisiBackups\` (dumps — these contain employee
PIN-related data per Card #34's own scope, so they need the same
protection):

1. Create the folders as `joshua` (they'll inherit `joshua`'s ownership).
2. Disable inheritance and strip inherited permissions:
   ```powershell
   icacls "C:\Users\joshua\PortalBenvisiSecrets" /inheritance:r
   icacls "C:\Users\joshua\PortalBenvisiBackups" /inheritance:r
   ```
3. Grant only what's needed:
   ```powershell
   icacls "C:\Users\joshua\PortalBenvisiSecrets" /grant:r "joshua:(OI)(CI)F"
   icacls "C:\Users\joshua\PortalBenvisiSecrets" /grant:r "SYSTEM:(OI)(CI)F"
   icacls "C:\Users\joshua\PortalBenvisiSecrets" /grant:r "Administrators:(OI)(CI)F"

   icacls "C:\Users\joshua\PortalBenvisiBackups" /grant:r "joshua:(OI)(CI)F"
   icacls "C:\Users\joshua\PortalBenvisiBackups" /grant:r "SYSTEM:(OI)(CI)F"
   icacls "C:\Users\joshua\PortalBenvisiBackups" /grant:r "Administrators:(OI)(CI)F"
   ```
   `SYSTEM` is required because the Scheduled Task should run as `joshua`
   with "Run whether user is logged on or not" (see §7) — the Task
   Scheduler service itself operates as SYSTEM to launch the task, though
   the process runs under `joshua`'s token. `Administrators` is kept for
   your own recovery access. No `Users`, `Authenticated Users`, or
   `Everyone` entry on either folder.
4. Verify:
   ```powershell
   icacls "C:\Users\joshua\PortalBenvisiSecrets"
   icacls "C:\Users\joshua\PortalBenvisiBackups"
   ```
   should list only `joshua`, `SYSTEM`, `Administrators` — nothing else.

I have not run any of the above. You should run it yourself on the server
(or explicitly tell me to run it in a follow-up message) since it's on the
STOP list for this slice.

## 5. Validation before promotion

Every run, before a file is ever given its final name:
1. `pg_dump` exit code must be `0`.
2. Output file must exist and be **≥ 50 KB** (the known-good manual dump was
   ~753 KB; anything near-empty is treated as a failure, not "small data").
3. `pg_restore -l` against the file must exit `0` and report **≥ 40**
   `TABLE DATA` entries (known-good manual dump: 49 entries across 49
   tables/`estoque_organizacao_*` included).

Any failure at any step → the temp file is deleted, nothing is promoted,
the script exits non-zero, and the previous night's valid backup is left
untouched. This mirrors the same "never mask a failed run as a valid
snapshot" rule already used by the existing `estoque` sync job.

Files are written first to `nightly\staging\...dump.tmp`, only `Move-Item`'d
(same-volume rename, atomic) into `nightly\dumps\...dump` after all checks
pass.

**Staging cleanup, success or failure:** `pg_dump`/`pg_restore` stdout+stderr
captures and the `pg_restore -l` listing are all written to small transient
files in `nightly\staging\` while the run is in progress. Whatever's useful
in them is written into the main per-run log first (e.g. `pg_dump` stderr
text on a dump failure, the TABLE DATA count on success) — then the
transient files themselves are always deleted at the end of the run, success
or failure alike, so `staging\` never accumulates debris across repeated
runs (including repeated failures).

## 6. Retention behavior (14 daily / 8 weekly / 12 monthly)

- **Daily bucket:** the newest 14 calendar days with a successful backup
  (one file per day — the latest if somehow more than one ran that day).
- **Weekly bucket:** the newest 8 ISO weeks, one representative file per
  week, for weeks not already fully covered by the daily bucket.
- **Monthly bucket:** the newest 12 calendar months, one representative file
  per month, for months not already covered above.

A file can satisfy more than one bucket at once (e.g. last night's dump is
simultaneously "today", "this week", and "this month") — buckets overlap by
design, so the real on-disk count is well under the theoretical 34-file
maximum in steady state.

**Safety net, independent of the above:** the single newest successful
dump is always retained no matter what the bucket math says, and if the
retention logic ever computes "delete everything" (e.g. a bug, or a
brand-new/degenerate file set), the script logs an error and **skips
deletion entirely that run** rather than risk deleting the only good copy.

**Retention failure is non-fatal.** The entire retention pass runs inside a
`try/catch`. `last_success.txt` and the heartbeat ping (section 7) are both
written *before* retention even starts — they represent "a new backup was
created, validated, and promoted," full stop, independent of whether the
subsequent housekeeping pass (deciding what old files to prune) also
succeeds. If retention throws for any reason, the script logs it as an
`ERROR` line and still exits `0`. This is deliberate: a bug in the pruning
logic must never make a genuinely successful backup look like a failed run
to Task Scheduler or to the dead-man's-switch — that would be a false alarm
at best, and at worst could train you to ignore real alerts.

## 7. Dead-man's-switch / failure visibility

The hard problem stated in the brief is real: if the Scheduled Task itself
never fires (disabled, server rebooted and the task didn't re-register, the
stored task credential expired, disk full before the script even starts),
the script's own error handling never runs — there's nothing to catch it.
Two complementary layers, proportional to a single-operator setup:

**Option A — recommended: external heartbeat ping (healthchecks.io free
tier, or equivalent such as Cronitor/UptimeRobot).** On every *successful*
promotion, the script does a single `Invoke-WebRequest` GET to a per-job
URL. The external service expects a ping roughly every 24h; if one doesn't
arrive (for any reason, including the task never starting), it emails you.
This is the standard pattern for exactly this failure mode, because the
alerting logic lives entirely outside the machine that might fail.

The URL itself functions like a bearer token — anyone holding it can fake a
"success" ping — so it is **not** hard-coded in `backup-prod.ps1` (the
script is committed to Git; a secret shouldn't be). Instead the script reads
it at runtime from `C:\Users\joshua\PortalBenvisiSecrets\heartbeat_url.txt`
on the server (`$HeartbeatUrlFile` in the script) — same folder and same
ACL as `pgpass.conf`, one line, just the URL. Missing file = heartbeat
silently disabled, logged as `INFO`, nothing sent. A present-but-malformed
value (doesn't start with `http`) is logged as a `WARN` and skipped rather
than attempted. The URL's contents are never written to any log line — only
"Heartbeat ping sent" / "Heartbeat ping failed (non-fatal)" / "Heartbeat
disabled" style fixed messages are logged, deliberately including on the
failure path (some .NET HTTP exceptions echo the request URI, including the
token, back in their exception message — the script logs a generic message
instead of that raw exception text for this one call).

Requires: you create a free healthchecks.io-style account and create
`heartbeat_url.txt` yourself, on the server, with the ping URL it gives you
(not a database secret, but still not something to paste through this chat
— same reasoning as the DB password). No production data is ever sent —
just an empty GET request.

**Option B — no third party, lower guarantee: a second, independent
Scheduled Task** ("Portal Benvisi — Backup Freshness Check"), also on the
server, running once daily at a fixed time comfortably after the backup
window (e.g. noon), that does nothing but check the age of
`last_success.txt`. If it's stale (> ~30h old), it writes a CRITICAL entry
to the Windows Application Event Log and/or drops a clearly-named file on
the Desktop (`BACKUP_STALE_CHECK_ME.txt`) so it's visible next time you're
at the server's console. This still depends on *a* Scheduled Task running,
but it's a second, independent, much simpler task — a much smaller blast
radius than "the backup task itself silently stopped," and it doesn't
require any external account.

My recommendation is **A**, with **B** as a cheap second layer if you want
belt-and-braces — they're not mutually exclusive. Pick one/both and I'll
wire it in; nothing is active yet (no `heartbeat_url.txt` exists, and the
Option B task doesn't exist).

## 8. Proposed Task Scheduler settings (not registered)

All of this is **on the server**, not the dev terminal.

- **Name:** `Portal Benvisi - Nightly Production Backup`
- **Run as:** `joshua`, **"Run whether user is logged on or not"** (so it
  survives logoff — this is also why the Scheduled Task's stored password
  for `joshua`'s Windows account, not the DB password, is needed; that's a
  Windows credential prompt at registration time, unrelated to
  `pgpass.conf`)
- **Trigger:** Daily, e.g. 02:00 local time (adjust to a quiet window)
- **Action:** Start a program
  - Program: `powershell.exe`
  - Arguments: `-NoProfile -ExecutionPolicy RemoteSigned -File "C:\PortalBenvisi\Backup\backup-prod.ps1"`
  - Start in: `C:\PortalBenvisi\Backup\`
  - Both paths point at the **deployed server copy**, not the dev
    terminal's Git checkout — see "Two machines" and "Deployment procedure"
    above. The server has no dependency on the dev terminal being on,
    reachable, or even existing at run time.
  - `RemoteSigned`, not `Bypass`: this server's `LocalMachine` policy is
    already `RemoteSigned` (checked read-only via `Get-ExecutionPolicy
    -List` on the server), which already permits running this
    locally-authored, unsigned script — `Bypass` would disable policy
    enforcement more broadly than this task needs. `RemoteSigned` on the
    invocation makes the requirement explicit without depending on the
    machine-wide policy never changing.
- **Settings:**
  - "Run task as soon as possible after a scheduled start is missed" — **on**
    (covers the server being off/asleep at 02:00)
  - "If the task fails, restart every" — 30 minutes, up to 3 attempts
  - "Stop the task if it runs longer than" — 1 hour (small DB; generous
    ceiling in case of a slow network night)
  - Do not run multiple instances in parallel

Nothing here has been created — this is the exact configuration to enter
once you're ready to approve activation.

## 9. Logs

`nightly\logs\backup_<timestamp>.log`, on the server — one file per run,
timestamped lines, step-by-step (`pg_dump exit code 0`, `TABLE DATA entries:
49`, retention deletions, etc.). Never contains the password: the script
never reads it into a variable at all (it's read directly by
`pg_dump`/`pg_restore` from `pgpass.conf`), so there's nothing secret for
the logger to accidentally capture. `pg_dump`/`pg_restore` stderr is
captured to small sidecar files in staging for debugging and always deleted
at the end of the run (see "Staging cleanup" in section 5); on success only
the (secret-free) `pg_restore -l` table-of-contents listing is kept, renamed
alongside the promoted dump.

## 10. First run

On the server, after deploying the script (section 2) and creating
`pgpass.conf` (section 3): run once manually with `-WhatIf` to see the
validation and retention logic exercise without promoting or deleting
anything:

```powershell
powershell -NoProfile -File "C:\PortalBenvisi\Backup\backup-prod.ps1" -WhatIf
```

Then a real supervised run (no `-WhatIf`) before trusting it to Task
Scheduler.

## 11. Restore procedure (rehearsed 2026-10-03)

This section is the **destructive restore** path — distinct from everything
above, which only ever produces and prunes files and never writes to any
Postgres database. Nothing in this section is automated yet; it is the
exact manual procedure that was rehearsed once, successfully, against the
separate QA Supabase project (never production), using a real unattended
nightly artifact. Read "11.5 Scope limitation" before relying on this for a
real incident.

### 11.1 Prerequisites

- A validated dump file from `nightly\dumps\` (or any file that already
  passed this script's own `pg_dump` exit-0 + size + `pg_restore -l`
  TABLE DATA checks — see section 5). Do not attempt to restore a file that
  failed validation.
- `pg_restore.exe` from the same EDB PostgreSQL 17 client tools used for
  backup (`C:\Program Files\PostgreSQL\17\bin\pg_restore.exe` — see
  `$PgRestoreExe` above). Version-match the client to the server you dump
  from; a restore rehearsal is also a reasonable time to confirm this.
- A target Postgres connection string/credentials for the **restore
  target** — a disposable/empty database (QA, or a fresh scratch database),
  never production, and never a target you need to keep working data on.
  Use the same `pgpass.conf`-style mechanism as backup (section 3) rather
  than typing a password on the command line or pasting one through chat —
  create a separate `pgpass.conf` entry (or a separate file) for the
  restore target's host/port/user, with the same ACL treatment.
- Confirm you are pointed at the restore target, not production, **before**
  step 1 below — step 1 is destructive. Print the target host/port/dbname
  from whatever connection string/service you're about to use and read it
  back before proceeding; there is no in-script safety net for this
  (unlike `backup-prod.ps1`, there is no restore automation yet — see
  "11.6 Proposed restore helper script").

### 11.2 Known issue: `citext` extension (discovered 2026-10-03)

Production has the `citext` extension installed in `public` (`citext |
public | 1.6` — used by `funcionarios.apelido`, `funcionarios.email`,
`funcionarios.escala_nome_planilha`, and any other `citext`-typed column).

**A `pg_dump --schema=public` archive does not, on its own, recreate the
`citext` extension before the objects that depend on it.** Restoring such
an archive into a database where `citext` isn't already installed fails
partway through, while creating `public.funcionarios` (or whichever table's
columns are typed `citext` first in restore order) — the column type itself
doesn't exist yet in the target. This is a property of restricting the dump
to `--schema=public` (extensions are catalog/database-level objects, not
schema-contents in the sense `--schema` filters on), not a bug in
`backup-prod.ps1`'s flags — the same thing would happen restoring *any*
`--schema=public`-scoped dump of a database that uses `citext` (or any
other extension) into a target that doesn't already have it.

**Do not change the nightly backup's `pg_dump` flags to work around this**
(e.g. dropping `--schema=public` to capture extensions implicitly) unless
there's a compelling reason to revisit the backup's scope — the fix below
is entirely restore-side and does not require changing what gets backed up
nightly.

### 11.3 Destructive restore procedure (copy/paste-safe)

Run these in order. Steps 1 is destructive to the target database — confirm
the target per "11.1 Prerequisites" first.

**Step 1 — clear the target's application schema.** Connect to the target
with `psql` and run:

```sql
DROP SCHEMA IF EXISTS public CASCADE;
```

**Step 2 — recreate an empty `public` schema:**

```sql
CREATE SCHEMA public;
```

**Step 3 — recreate the `citext` extension *before* restoring anything
else:**

```sql
CREATE EXTENSION citext WITH SCHEMA public;
```

If the target database uses other extensions your dump's schema depends on
(check `SELECT extname, extnamespace::regnamespace, extversion FROM
pg_extension;` on **production**, not the target, to get the authoritative
list), create those here too, before step 6. `citext` is the only one this
rehearsal needed, because it's the only extension-backed type currently
used by any `public`-schema column.

**Step 4 — generate a TOC listing from the dump file** (does not touch the
target database; purely reads the dump file):

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -l "<path-to-dump-file>" > restore_list.txt
```

**Step 5 — disable exactly two entries in `restore_list.txt`.** Open it in a
text editor and find the two lines that look like:

```
;NNNN; 2615 2200 SCHEMA - public <some-role>
;NNNN; 0 0 COMMENT - SCHEMA public <some-role>
```

(exact entry numbers `NNNN` vary per dump — match on the `SCHEMA - public`
and `COMMENT - SCHEMA public` text, not a specific line number). Prefix
**only those two lines** with a semicolon `;` at the very start of the line
to disable them (`pg_restore -L` treats a leading `;` as "skip this
entry" — this is standard `pg_restore` TOC-editing syntax, not a special
convention of this procedure). Leave every other line untouched. Save the
file.

This is necessary because the target's `public` schema already exists (you
just created it in step 2) with properties/ownership set by the target
database itself (e.g. Supabase's own default `public` schema setup) — the
dump's own `CREATE SCHEMA public` and its `COMMENT ON SCHEMA public` TOC
entries would otherwise conflict with that and abort the restore under
`--exit-on-error` (see step 6). Disabling just those two entries lets every
*other* object in the dump (tables, functions, data, etc.) restore
normally into the `public` schema you already prepared in steps 2-3.

**Step 6 — restore using the edited list:**

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" `
  -L restore_list.txt `
  --no-owner --no-privileges --exit-on-error `
  -d "<target-connection-string>" `
  "<path-to-dump-file>"
```

A successful restore exits `0`. `--exit-on-error` means the first real
problem stops the restore immediately rather than completing partially and
reporting errors only at the end — treat any nonzero exit as "the target
database is now in an unknown/partial state," not as "mostly fine."

### 11.4 Post-restore validation

Before trusting a restored database for anything (a rehearsal review, or a
real recovery), check at minimum — all of these were checked in the
2026-10-03 rehearsal (see "11.5" for the actual numbers):

- Table count in `public` matches the source's table count.
- Function count in `public` is non-zero and in the expected range (RPCs
  are how this app is accessed — see root `CLAUDE.md`'s "Prefer RPCs over
  exposing tables directly" — a restore that lost functions silently
  breaks every RPC-only access path even if the tables look fine).
- Row counts for a few known-size tables (pick ones you can sanity-check
  against a recent production number, e.g. `funcionarios`, `estoque_atual`).
- `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND
  rowsecurity = true;` matches the full table count — RLS is enabled with
  **zero policies** on every table in this schema by design (every table
  migration in `supabase/migrations/` does this); a restore that silently
  disabled RLS on any table would be a serious, easy-to-miss regression.
- Non-internal trigger count and constraint/foreign-key counts are
  non-zero and in the expected range — a schema that "looks complete" by
  table/column count alone can still be missing constraints if something
  in the restore order went wrong.
- `citext` extension is present (`SELECT extname, extnamespace::regnamespace,
  extversion FROM pg_extension WHERE extname = 'citext';`).
- Any singleton/state tables your app relies on for correctness, not just
  existence — e.g. this app's `estoque_organizacao_rotacao_estado` (see
  `supabase/migrations/20260927_101_*`) is a one-row rotation counter;
  confirm it restored with exactly one row and a plausible value, not just
  that the table exists.

### 11.5 Rehearsal acceptance evidence (2026-10-02 backup / 2026-10-03 restore)

**Backup artifact restored:** `portal_benvisi_20261002_020000.dump`
(781,083 bytes, 49 `TABLE DATA` entries per `pg_restore -l` — this is the
first genuine *unattended*, Task-Scheduler-driven nightly run, not a
manually-invoked one).

**Restore target:** the separate QA Supabase project — intentionally
disposable/empty beforehand (49 `public` tables already present from
migrations, 0 `funcionarios` rows, 0 `escalas_trabalho` rows).

**Result:** `pg_restore` exit code `0`, following the exact procedure in
"11.3" (including the `citext` discovery, which is why this rehearsal
exists as documentation at all — without it, step 3 and the TOC edit in
step 5 would not have been obvious).

**Post-restore validation, all PASSED:**

| Check | Result |
|---|---|
| `public` tables | 49 |
| `public` functions | 171 |
| `funcionarios` rows | 12 |
| `estoque_atual` rows | 15,572 |
| Tables with RLS enabled | 49 / 49 |
| Non-internal triggers | 5 |
| Constraints | 223 |
| Foreign keys | 71 |
| `citext` extension | `public`, `1.6` |
| `estoque_organizacao_*` tables present | 3 |
| `estoque_organizacao_atribuicoes` rows | 10 |
| `estoque_organizacao_rotacao_estado` rows | 1 (`proximo_numero=11`, `ativo_a_partir=2026-10-04`) |
| `estoque_organizacao_sync_falhas` rows | 0 |

This is accepted as **PASS** for the off-platform backup + restore
rehearsal portion of the Supabase resilience work (Card #34). Schema
baseline/drift reconciliation (making the restored schema reproducible
from migrations rather than only from a dump) is explicitly **not** covered
by this rehearsal and remains a separate, later phase — see the note at
the top of this document.

### 11.6 Proposed restore helper script (not implemented)

Steps 4-5 above (generate the TOC list, find and comment out exactly two
specific lines) are the most error-prone part of this procedure for a
future operator under incident pressure — getting the match wrong (e.g.
commenting out the wrong `SCHEMA` entry, or missing one of the two) either
breaks the restore or silently restores the dump's own schema-ownership
metadata over the target's.

**Proposal, not yet built:** a small, read-only-until-the-final-step
helper (e.g. `scripts/backup-prod/generate-restore-list.ps1`) that takes a
dump file path, shells out to `pg_restore -l`, and writes an edited list
file with the `SCHEMA - public` and `COMMENT - SCHEMA public` lines
automatically commented out (matched by the literal text in those two
columns, not by line number) — stopping there and printing the resulting
file's path and a diff-style summary of what it changed, rather than ever
invoking `pg_restore` with `-L` itself. The actual restore command (step 6)
would stay a manual, explicit, copy/paste action — this only removes the
error-prone manual text-editing step, not the human decision to actually
restore.

This has **not** been written. Tell me to build it if you want it; it's a
small, independently-testable script (pure text transformation, same
testing style as `retention-lib.ps1`/`test-retention.ps1` — no live
database or dump file needed for its own tests, just sample `pg_restore -l`
output as fixtures).

## 12. Scope limitation: application schema only

**This backup (and the restore procedure above) covers the `public`
schema's objects and data only** — the application schema this Portal
actually reads and writes (tables, functions, RLS). It does **not** back
up or restore Supabase-managed `auth`, `storage`, `realtime`, `extensions`,
`graphql`, `graphql_public`, `pgbouncer`, `supabase_functions`,
`supabase_migrations`, or `vault` schemas, nor any Supabase Storage bucket
contents, Auth users, or Edge Functions configuration.

**Current Portal Benvisi does not rely on any of those for application
recovery** — this app has its own PIN/session model (`funcionarios`,
`sessoes_funcionario`, `verify_pin`/`issue_employee_session` — see root
`CLAUDE.md`: "Portal uses its own PIN/session model, not Supabase Auth
sessions") and does not use Supabase Storage or Realtime. A restore of the
`public` schema alone is therefore sufficient to recover this app's actual
functionality as it exists today.

**This must be revisited if that ever changes** — e.g. if a future feature
starts using Supabase Auth, Storage, or Realtime, this backup/restore
procedure would need to be extended (a full `pg_dump` without `--schema`
restriction, plus a separate Storage object backup, are the two most
likely additions) before this documentation's "sufficient for recovery"
claim would still be true. Whoever adds such a dependency should update
this section as part of that change, not as an afterthought.
