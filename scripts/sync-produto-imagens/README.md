# Lacoste product-image worker (Trello #10)

Acquires and publishes Lacoste product images for Portal Benvisi's Consulta
de Estoque. Standalone nested npm project, deliberately isolated from the
Portal root dependency graph — `package.json` here is independent of the
repo root `package.json`, and none of this worker's dependencies are added
there.

## Why isolated

Playwright (bundles a full Chromium download) and Sharp (per-platform
native bindings) are heavy, platform-specific, ops-only dependencies with no
reason to exist in Portal's browser bundle, Vercel build, or the root
lockfile every contributor installs. This repo's existing ops-script
precedent
([`scripts/sync-estoque`](../sync-estoque)) puts its one dependency
(`mssql`) in the root `package.json` as a devDependency — acceptable for a
slim SQL driver, not for this set. This worker gets its own `node_modules`
instead.

## Why headed Chromium, why Windows

Lacoste's site (and its image CDN) sits behind Akamai Bot Manager. Across
this engagement's discovery POCs: plain HTTP, the default Playwright
headless shell, and both `channel: 'chromium'` and `channel: 'chrome'`
headless modes were all confirmed blocked (some only after initially
working, then regressing mid-session — see project history). **Headed
Chromium (`headless: false`) is the only mode proven reliable**, which
means this worker needs to render into an active, logged-in Windows desktop
session — it cannot run as a typical unattended background/SYSTEM service
today. The exact deployment/scheduling answer for that constraint is a
separate decision, not resolved by this slice.

## What this slice is

Foundation only: the nested project, its dependencies, and a dependency
health-check script that validates each library loads/imports correctly in
this environment. No Lacoste acquisition, no AI calls, no Supabase access,
no Storage, no Portal UI changes.

## Setup

```sh
cd scripts/sync-produto-imagens
npm install
cp .env.example .env
# .env is not required to pass `npm run check` in this slice — it exists
# now so later slices don't need a setup-order change.
```

## Validate the dependency foundation

```sh
npm run check
```

This imports every worker dependency (Playwright, Sharp, the Anthropic SDK)
and reports pass/fail per library, plus confirms a Chromium browser binary
is installed for Playwright. It makes **no network calls** — no Lacoste
navigation, no Anthropic API call, no Supabase connection. See the script's
own output for exact results on this machine.

## Dependencies (current versions, pinned loosely via `^`)

| package             | role                                                                                                                                                                                                                                                                                  | tier        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `playwright`        | headed Chromium automation against lacoste.com.br                                                                                                                                                                                                                                     | acquisition |
| `sharp`             | image resize/optimize (webp) before publish                                                                                                                                                                                                                                           | publish     |
| `@anthropic-ai/sdk` | bounded vision calls for ALL candidate visual judgments structured metadata can't answer — person/model present, complete-vs-crop, likely front/back/other view, and whether a plausible secondary view is materially useful — advisory candidate scoring only, never auto-publishing | scoring     |

A local TensorFlow (`tfjs-node` + `coco-ssd`) person-detection tier was
evaluated and dropped before this dependency set was finalized: `tfjs-node`
requires a native build toolchain (Visual Studio "Desktop development with
C++") that isn't present on the target Windows worker machine, and
installing it was explicitly ruled out rather than pursued. The bounded
Anthropic vision step now covers person/model detection too, not just the
front/back materiality judgment it was always going to handle — still
advisory-only, still gated by mandatory human approval.

## Slice 2 — bounded deterministic acquisition worker

```sh
npm run acquire -- --produtos=46SMA0045BR:02H,FH2349-23:02S,NF2142AA:A91 --dry-run
```

- `--produtos=REF:COR,REF:COR,...` — explicit bounded input. This slice has
  **no full-catalog path**: omitting `--produtos` is a usage error, not a
  silent whole-catalog scan.
- `--limit N` — caps how many parsed `--produtos` items are processed
  (default hard cap: 5, applied even without `--limit`).
- `--dry-run` — performs real acquisition/verification against Lacoste but
  skips all Supabase writes (no `produto_imagem_execucoes` row, no
  `produto_imagem_candidatos` row).

### How resolution works

One headed Chromium page visits the BRECOM homepage once per run to
establish an Akamai-trusted session, then every `PRODUTO:COR` is resolved
via the same-origin `Product-PartialsData` endpoint, called with `fetch()`
from that page's JS context — never via `page.goto()` to the endpoint
itself (confirmed: direct top-level navigation to
`/on/demandware.store/...` controller URLs gets silently bounced back to
the homepage; in-page `fetch()` from an already-trusted session does not
have this problem, and no per-item page navigation is needed at all — the
same homepage-established session serves every item's `fetch()` call).

**Confirmed, load-bearing fact:** an invalid/unavailable color on a valid
master PID does **not** error. The endpoint silently falls back to a
default color variant and still returns HTTP 200 with a fully-formed
`product` object whose `color.id` differs from what was requested. HTTP
200 is therefore never sufficient — `product.masterProductId` and
`product.color.id` are checked exactly against the request on every call.
See `src/lacoste.mjs` for the full `EXACT_MATCH` /
`PRODUCT_FOUND_COLOR_NOT_FOUND` / `AMBIGUOUS` / `NOT_FOUND` classification.

Gallery images of `type: "look"` (styling/outfit shots) are excluded
before any row is written — only `type: "image"` entries reach
`gallery_json`.

### What this slice does not do

No AI/vision calls, no primary/secondary candidate selection, no image
downloads/Storage, no `produto_imagem_publicadas`, no approval/rejection
RPCs. Those are later slices.

## Slice 4B — human approval and publication

Approval and publication are separate stages with separate actors:

1. **Approval (employee, browser).** `aprovar_candidato_imagem(token, candidato, indice_principal, indice_secundaria?, observacao?, confirmar_divergencia?)`
   and `rejeitar_candidato_imagem(token, candidato, observacao)`. The reviewer
   comes only from the session token and must have
   `funcionarios.pode_gerenciar_imagens_produto`. Indices refer to the stored
   gallery and may differ from the AI recommendation, but every chosen index
   (primary and secondary) must have a stored AI evaluation with
   `has_person = false` and `product_only_still = true`. There is no override:
   `confirmar_divergencia` is kept only for signature compatibility and has no
   effect. `scoring_notes.human_reviewed` is never read.
   Approval creates a `pendente` publication with DB-assigned immutable paths:
   `{produto}/{cor}/{publicacao_id}/{principal|secundaria}.webp`.
2. **Publication (this worker, service_role).**

   ```bash
   npm run publicar                  # dry-run: list + validate, no writes
   npm run publicar -- --persist     # download, convert, upload, activate
   npm run publicar -- --persist --limit=3
   ```

   Each approved image is fetched through the headed browser, converted to
   WebP (longest edge 1200 px, quality 82) and uploaded to the public bucket
   `produto-imagens-publicadas` with `upsert: false`. The set goes live in one
   transaction (`ativar_publicacao_imagem`), superseding the previous set for
   that product/colour.

**Bucket.** `produto-imagens-publicadas` is provisioned once per project
(not by a migration): public read, `image/webp` only, 2 MB file limit, and no
`storage.objects` policies, so only `service_role` can upload, overwrite,
delete or list. Production was provisioned on 2026-11-02:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produto-imagens-publicadas', 'produto-imagens-publicadas', true, 2097152, array['image/webp'])
on conflict (id) do nothing;
```

**Integrity.** The approved URL must carry Salesforce Commerce Cloud's
content-version token (`/dw<hex>/`) and the approved colour code in its file
name, so the published bytes are the asset version the reviewer saw. Source
and WebP SHA-256 are recorded per file.

**Retries.** Files already recorded are skipped. An object that already exists
is accepted only if byte-identical (crash after upload); otherwise the run
refuses and never overwrites. Failures increment `tentativas`/`ultimo_erro`
and the set stays `pendente`; see "Scheduled runs" below for the retry limits.

**Revocation / replacement.** `revogar_publicacao_imagem(token, publicacao, motivo)`
hides a set from Consulta immediately. A newer approval replaces the active
set only when it is activated. Rows are never deleted.

**Manual cleanup (~30 days).** Superseded/revoked/cancelled files stay in the
bucket. Paths eligible for manual deletion:

```sql
select a.storage_path, p.status, p.encerrado_em
  from produto_imagem_publicacoes p
  join produto_imagem_publicacao_arquivos a on a.publicacao_id = p.id
 where p.status in ('substituida', 'revogada', 'cancelada')
   and a.enviado_em is not null
   and p.encerrado_em < now() - interval '30 days'
 order by p.encerrado_em;
```

**Reviewer previews.** Lacoste CDN gallery URLs load directly in a normal
browser `<img>` (verified from a cookieless browser on a foreign origin), so
the review UI can show them without storing unapproved images anywhere.

## Scheduled runs (Windows Task Scheduler)

Validated on the development PC: a task set to "Run only when user is logged
on" launches headed Chromium and fetches a Lacoste CDN image both with the
desktop unlocked and locked. **Not** expected to work when the user is logged
out or before the first login after a reboot (no interactive desktop). The
CDN serves images as AVIF to Chromium; `toWebp` decodes it (covered by
`test/avif.test.mjs`).

### Safeguards

| concern          | behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| overlapping runs | `--persist` takes a lock file (`PUBLICAR_LOCK_FILE`, default `%TEMP%\portal-benvisi-publicar.lock`) holding the owner PID. A second run logs "outra execução em andamento" and exits 0. A lock whose owner is **alive is never taken over, however old**; a dead owner's lock is taken over (serialized by a guard folder, so two runs cannot both win). If a crash left a lock whose PID was reused by an unrelated program, delete the lock file named in the log message. |
| whole-run limit  | `PUBLICAR_MAX_RUNTIME_MIN` (default 20): close Chromium, exit 124; 30 s later force exit. The wrapper adds an outer limit that kills the whole process tree.                                                                                                                                                                                                                                                                                                                 |
| hung item        | `PUBLICAR_ITEM_TIMEOUT_SEC` (default 180): the item is recorded as a failed attempt and the run stops, so one bad item cannot block the queue head forever.                                                                                                                                                                                                                                                                                                                  |
| interruption     | Ctrl+C / SIGTERM close Chromium and release the lock. A hard kill leaves a stale lock that the next run recovers. Interrupted work costs no attempt and resumes safely (immutable paths, sha checks).                                                                                                                                                                                                                                                                        |
| empty queue      | No browser, no execution row, exit 0.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| dry-run          | Never takes the lock, launches a browser or writes.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| bounded retries  | Migration `20261103_001`: failure 1-4 back off 15 min, 1 h, 4 h, 6 h; failure 5 is permanent (`falha_permanente_em`). The approval stays intact and the publication stays `pendente`.                                                                                                                                                                                                                                                                                        |

Exit codes: 0 ok / nothing to do / another run active; 1 run-level error;
2 a publication failed (recorded, will retry unless permanent); 124 time limit;
130/143 interrupted; 3 wrapper problem.

### Wrapper

`run-publicar.ps1` runs the worker, appends timestamped output and the exit code
to `%LOCALAPPDATA%\PortalBenvisi\logs\publicar-YYYYMMDD.log` (30 days kept) and
returns the worker's exit code. It is **dry-run unless `-Persist` is given**.
Paths are parameters or `PUBLICAR_WORKER_DIR`, `PUBLICAR_LOG_DIR`,
`PUBLICAR_NODE`, so the same script works on another machine.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run-publicar.ps1            # dry-run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run-publicar.ps1 -Persist   # publishes
```

### Manual publication

Double-click **`publicar-agora.cmd`** ("Publicar imagens agora"). It only starts
`run-publicar.ps1 -Persist`, so logging, the lock and the time limits are the
same as for the scheduled run, then prints the outcome in Portuguese (done /
a publication failed and will retry / time limit / error) and where the log
is. If a scheduled run is in progress, the manual run exits without doing
anything; nothing is duplicated.

### Operating model

- **One automatic run daily at 03:00**, plus **manual runs at any time**. Both
  go through the same wrapper and the same single-instance lock.
- **Missed runs lose nothing.** Approved publications stay queued
  (`pendente`) and are picked up by the next run, scheduled or manual.
- **Windows must be awake with the user logged in** (screen lock is fine).
  There is no auto-login and no change to Windows security settings; if the PC
  is asleep, off or logged out at 03:00, the run is simply missed.
- A publication that fails is retried on later runs with backoff (15 min, 1 h,
  4 h, 6 h) and parked after the 5th failure (see below). With one run a day,
  a failed item is therefore retried about once a day.

Task settings to use when the task is created (it is **not** created or
activated by this repo): trigger daily at 03:00; run as the interactive user,
"Run only when user is logged on"; not elevated; do not start a new instance;
stop after 30 minutes; "start when available" **off** (a late catch-up run
while someone is using the PC is not wanted - use the manual shortcut instead);
do not wake the computer. Action: `powershell.exe -NoProfile
-ExecutionPolicy Bypass -File "<worker folder>
un-publicar.ps1" -Persist`.

### Finding and re-queuing permanently failed publications

```sql
select p.id, p.produto, p.cor_codigo, p.tentativas, p.ultimo_erro, p.ultimo_erro_em
  from produto_imagem_publicacoes p
 where p.status = 'pendente' and p.falha_permanente_em is not null
 order by p.ultimo_erro_em;

-- after fixing the cause (service_role / SQL editor only):
select reenfileirar_publicacao_imagem('<publicacao id>');
```
