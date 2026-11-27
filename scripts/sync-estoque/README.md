# Consulta de Estoque — manual inventory sync

One-shot, manually-run publish of the Manaus store inventory from Linx
(Microsoft SQL Server, on-prem) into the Portal Supabase `estoque_*` tables.
No Task Scheduler / cron yet — the goal of this milestone is to prove one
complete real Linx → Supabase publish.

## What it does

1. inserts an `estoque_sync_execucoes` row with `status = 'executando'`;
2. runs [`linx-query.sql`](./linx-query.sql) against Linx — one row per
   `produto + cor_codigo + tamanho_key` for every product/colour with
   `ESTOQUE > 0` at `LINX_FILIAL`, restricted to the **applicable / labelled**
   grade positions (every real size, zero-stock sizes included; the unused
   `ES*` padding positions are dropped). Reads all 48 physical Linx positions
   — there is no hard-coded maximum grade size;
3. normalizes any **negative** size-level `quantidade_estoque` to `0` before
   validation (locked decision, 2026-10-02 — supersedes the prior
   2026-09-09 "abort the run" stance). A negative available quantity is a
   known Linx size-level data inconsistency (confirmed case: produto
   `CH2932-23` / cor `2QB` / `tamanho_key 1` at `-1` while the
   product/colour's aggregate Linx `ESTOQUE` was `3`) and is never useful to
   a salesperson, so it no longer blocks the whole inventory refresh. Linx
   itself is never modified. Every normalized row is logged as a WARNING
   (produto, cor_codigo, tamanho_key, original and normalized value) and
   counted (`negativos_normalizados` in the logged extraction stats) — the
   anomaly is normalized, not silently discarded;
4. validates locally: rows > 0, no duplicate `(produto, cor_codigo,
tamanho_key)`, canonical keys populated, **`tamanho_venda` non-blank for
   every row**, quantities are non-negative integers (guaranteed by the
   normalization step above) and otherwise valid (e.g. integer-typed);
5. bulk-inserts every row tagged with the new `sync_id` (1 000-row chunks);
6. confirms the Supabase row count for that `sync_id` matches the extraction
   (uniqueness is enforced by the table's unique constraint);
7. marks the execution `sucesso` with `concluido_em`, `linhas_extraidas`,
   `linhas_publicadas`.

If anything fails, the execution is marked `erro` and **the previous
successful snapshot is left untouched** — the read RPCs only ever surface the
latest `status = 'sucesso'` execution.

## Setup

The `mssql` driver is a devDependency (in `package.json`; run `npm install`
if it is not yet in your `node_modules`). It is dev/ops only — never imported
by `src/`, never in the browser bundle.

```sh
cp scripts/sync-estoque/.env.example scripts/sync-estoque/.env
# then fill in scripts/sync-estoque/.env
```

Authoritative Linx connection, already pre-filled in `.env.example`:

| var                 | value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `LINX_SQL_SERVER`   | `aplserver` (→ `aplserver.benvisi.local` / 192.168.0.201, TCP 1433 reachable) |
| `LINX_SQL_DATABASE` | `Lacoste_60420`                                                               |
| `LINX_SQL_USER`     | `portal_benvisi_estoque` (dedicated read-only SQL login)                      |

Two secrets must be entered by hand into `.env`: `LINX_SQL_PASSWORD` and
`SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → Project Settings → API →
`service_role`). Neither is stored anywhere on this PC in a reusable form.

## Run

```sh
# connectivity + extraction + validation only, no writes:
node scripts/sync-estoque/sync-estoque.mjs --dry-run

# the real thing:
node scripts/sync-estoque/sync-estoque.mjs

# barcode check now, regardless of cadence (guards still apply):
node scripts/sync-estoque/sync-estoque.mjs --force-barcode-check

# accept a reviewed >10% barcode removal (barcode-only override):
node scripts/sync-estoque/sync-estoque.mjs --force-barcode-check --allow-large-barcode-removal
```

## The Linx query — verified live

`linx-query.sql` was validated against the live `Lacoste_60420` schema:

- `PRODUTOS_TAMANHOS` is keyed by `GRADE` only (no `PRODUTO` column); size
  labels are joined via `PRODUTOS.GRADE`.
- `PRODUTOS.PRODUTO` and `PRODUTO_CORES (PRODUTO, COR_PRODUTO)` are unique.
- Two filial strings exist; `= @filial` with `'LACOSTE SHOPPING  MANAUS'`
  (double space) matches only the intended one via ANSI trailing-space rules.
- The extraction reads all 48 physical `ES*` / `TAMANHO_*` positions and then
  emits a position **only if** its grade label is non-null / non-blank —
  positions are dropped for being unlabelled, never for a key threshold.

Output column contract (top of `linx-query.sql`): `produto, desc_produto,
tipo_produto, linha, grade, cor_codigo, cor_descricao_linx, tamanho_key,
tamanho_venda, quantidade_estoque` + the `@filial` bind parameter.

## Expected size (reconciliation baseline — drift-tolerant)

Applicable-grade grain, 2026-09-09 inspection (rule `ep.ESTOQUE > 0`):

| metric                   |  value |
| ------------------------ | -----: |
| produto_cores            |  1 371 |
| applicable rows          | 15 506 |
| sizes > 0                |  3 705 |
| applicable sizes = 0     | 11 801 |
| sizes < 0                |      0 |
| max `tamanho_key` in use |     20 |

For reference, the raw fixed-48 rectangle is `1 371 × 48 = 65 808`, of which
50 302 are unlabelled padding — **all** at quantity 0 (0 positive, 0
negative), so dropping them loses no stock information.

`~15 506` is a **soft** reconciliation figure: the script only logs a WARNING
past ±15 %. Assortment and grade changes move it over time and must not be
rejected; `max_tamanho_key` is reported per run and is data, not a cap.

## Barcode Slice 1

Each run may also maintain `estoque_barcodes` (barcode → produto/cor/tamanho_key)
from `PRODUTOS_BARRA` via [`linx-barcode-query.sql`](./linx-barcode-query.sql)
and [`estoque-barcode-diff.mjs`](./estoque-barcode-diff.mjs). Scope: active,
non-blank barcodes of every produto+cor with any `ESTOQUE_PRODUTOS` row for the
store (zero/negative stock included), so sold-out items stay recognizable.
Aliases (several barcodes per SKU) are kept, leading zeros preserved; dash-only
placeholder sizes and ambiguous barcodes (one code → several SKUs) are not
published (ambiguous ones are logged as audit warnings).

**Cadence** — no extra scheduled task; the hourly run performs a barcode check
only when one is due:

| reason             | when                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| `inicial`          | nothing published yet (or the published hash was cleared after drift)               |
| `semanal`          | no successful check since Monday 00:00 America/Manaus (first run of the week)       |
| `novo_produto_cor` | a new inventory produto+cor has no mapped barcode (restocked colours don't count)   |
| `manual`           | `--force-barcode-check` (bypasses cadence, never the guards)                        |
| `retry`            | the previous check failed or was blocked (`check_pendente`, stored in the database) |

Quantity-only changes never trigger a check. **Limitation:** a product/colour
introduced with zero stock, or a new size barcode on an already-mapped colour,
does not appear as a new inventory group and is picked up by the weekly check
(or a manual force-check).

When due, the full normalized mapping is hashed (SHA-256). If it equals the
published hash the check is recorded as successful **without reading
`estoque_barcodes` or writing mapping rows**; otherwise the delta is computed
against the full current mapping, staged and published in the same
`estoque_aplicar_sync` transaction, and only then is the published hash
advanced. State lives in `estoque_barcode_sync_estado`; every execution records
`barcode_check_status` / `barcode_check_motivos` / `barcode_hash` /
`barcode_erro` in `estoque_sync_execucoes`.

**Failure isolation** — any barcode failure (state read, Linx extraction,
remote read, the >10 % removal guard, partial staging, apply) skips only the
barcode publication: inventory and price still apply, the previous mapping is
kept, a `BARCODE_CHECK_*` warning is recorded and the check is retried on the
next hourly run. The barcode removal guard has its own override,
`--allow-large-barcode-removal` (separate from `--allow-large-removal`).
`--dry-run` reports what the barcode check would do and never advances state.

New barcode files must be copied onto the scheduled-task server together with
`sync-estoque.mjs`. [`validate-barcode-scope.sql`](./validate-barcode-scope.sql)
(read-only, run on Linx) mirrors the extraction and normalization exactly and
counts every drop reason, ambiguity and positive-stock coverage.

## Barcode QA tests

Offline (no database):

```sh
node scripts/sync-estoque/test-diff-engine.mjs
```

Integration — **QA project only** (`fupdeihsucacsprunljk`). The test resets the
estoque current-state tables of its target and refuses to run unless the
server's `system_identifier` matches QA's. Prerequisites:

1. QA restored from `supabase/baseline/` + post-watermark migrations (see
   `supabase/baseline/README.md`), with the synthetic employee
   `QA Teste Vendedor` present.
2. `supabase/migrations/20261125_001_add_estoque_barcodes.sql` applied to QA.
3. A PostgreSQL 17 client directory with `bin\psql.exe`,
   `conf\pgpass.conf` (QA session-pooler entry, user-only ACL) and
   `conf\supabase-prod-ca-2021.crt` (TLS `verify-full`).

```powershell
.\scripts\sync-estoque\qa\run-barcode-qa.ps1 -PgRoot C:\Users\benvi\Tools\postgresql17
```

It drives the real `runReal` / `runDryRun` orchestration with fixture "Linx"
rows through [`qa/psql-supabase-client.mjs`](./qa/psql-supabase-client.mjs)
(psql as `service_role`, so the real grants and RPCs are exercised) and then
checks lookup outcomes, sessions and access control with SQL.

## Price V1

Each run also extracts and publishes the full/list price (Linx R3,
`PRODUTOS_PRECO_COR.PRECO1`) for every produto+cor currently in Manaus
inventory, via [`linx-price-query.sql`](./linx-price-query.sql) and
[`estoque-price-diff.mjs`](./estoque-price-diff.mjs). This is a second,
independent extraction/diff/stage pass in the **same** sync execution —
price can change even when quantities do not, so it is never gated on the
inventory diff finding anything to stage. Both deltas are staged before
either is applied, and `estoque_aplicar_sync` applies both in the same
Postgres transaction: a failed price read/validate aborts the whole run
(nothing staged or applied), and a genuinely unexpected error during apply
rolls both deltas back together.

- Price grain is produto+cor only (never per-size) — stored in
  `estoque_precos_atual`, kept as compact as `estoque_atual_grupos` by
  scoping the R3 extraction to the same `FILIAL = @filial AND ESTOQUE > 0`
  qualifying set as the inventory query, not the whole nationwide R3 table
  (140 554 rows) it lives in.
- `PRECO1 <= 0` and rows with a blank produto/cor_codigo (a handful of R3
  placeholder rows, verified live) are excluded before staging — treated as
  "no price", never shown as `R$ 0`.
- A produto/cor with no R3 price still shows its inventory row; Consulta
  renders `—` for the price. Coverage is logged every run
  (`preco_sem_correspondencia` on `estoque_sync_execucoes`) but never blocks
  the sync.
