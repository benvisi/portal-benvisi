# Salesperson Metrics — production sync (Slice A)

Publishes curated daily salesperson sales aggregates from Linx to Supabase
(`public.vendas_diarias_vendedor`), for the Portal to read later via the
`get_vendas_metricas_mtd` RPC. **The browser never queries Linx directly** —
this script is the only thing that does.

This is Slice A of the Salesperson Metrics Portal: the data feed only. No
React/UI, no scheduler wiring, no commission/payroll calculation. It reuses
the locked extraction/classification/KPI logic from
[`scripts/sales-metrics-reconciliation/`](../sales-metrics-reconciliation/)
verbatim rather than redefining it.

## What it does

1. Loads the current `funcionarios.codigo_vendedor_linx` mapping from
   Supabase (`vendas_diarias_mapeamento_vendedores` RPC).
2. For each target date (default: yesterday + today, America/Manaus calendar
   days), runs the same single `SELECT` as the reconciliation tool
   (`linx-vendas-query.sql`) and classifies every ticket the same way:
   valid vs. cancelled, zero/multi-attribution anomaly, cleanly-resolved.
3. Groups cleanly-resolved valid tickets by salesperson for that day and
   maps each `VENDEDOR` code to a `funcionario_id`.
4. Writes the day's rows via `vendas_diarias_substituir_dia` — a single
   transaction that deletes and re-inserts that day's full row set, so
   reruns are idempotent even if attribution for the day changed since the
   last run (e.g. a late cancellation).

Three categories of valid ticket are **excluded** from what gets published,
and reported to stdout instead of guessed:

- zero-attribution anomaly (no `LOJA_VENDA_VENDEDORES` row for the ticket)
- multi-attribution anomaly (>1 distinct `VENDEDOR` for the ticket)
- unmapped `VENDEDOR` code (resolves cleanly, but
  `funcionarios.codigo_vendedor_linx` has no match — never guessed by name)

A day whose `(CODIGO_FILIAL, TICKET, DATA_VENDA)` grain is found to be
non-unique (duplicate canonical keys) is skipped entirely for that run
rather than written with questionable data; it will be retried on every
subsequent run that includes that date until the underlying data is fixed.

## Setup

```sh
cp scripts/sales-metrics-sync/.env.example scripts/sales-metrics-sync/.env
# fill in LINX_SQL_PASSWORD and SUPABASE_SERVICE_ROLE_KEY
```

Requires the `funcionarios.codigo_vendedor_linx` mapping to be populated for
at least the salespeople you want published — an employee with no mapping
will simply show up in the "UNMAPPED" log lines until mapped.

## Run

```sh
# Preview only — no Supabase writes. Still requires a working Supabase
# service-role connection (to read the current vendor mapping).
node scripts/sales-metrics-sync/sync-vendas-diarias.mjs --dry-run

# Real sync — refreshes yesterday + today for the default filial (060420)
node scripts/sales-metrics-sync/sync-vendas-diarias.mjs

# Backfill/testing a specific set of dates
node scripts/sales-metrics-sync/sync-vendas-diarias.mjs --dates 2026-09-01,2026-09-02

# A different filial
node scripts/sales-metrics-sync/sync-vendas-diarias.mjs --filial 060421
```

Every run logs, per day: rows examined/valid/cancelled, zero/multi
attribution anomaly counts, mapped/unmapped vendedor counts (with each
unmapped code/name/value listed), the Linx query duration, and the total
sync duration — use these numbers to decide the real scheduling interval
(5-minute vs. 1-minute) later. **No Task Scheduler wiring is part of this
slice** — invoke manually (or via whatever ad-hoc mechanism you choose)
until that decision is made.

## Tests

```sh
node scripts/sales-metrics-sync/test-sync-vendas-diarias.mjs
```

Covers this script's own added logic (Manaus date windowing, CLI parsing,
mapping resolution). The underlying classification/KPI logic it reuses is
covered by
[`test-reconcile-vendas.mjs`](../sales-metrics-reconciliation/test-reconcile-vendas.mjs).

## Stopping point (locked scope for this slice)

Deliberately does **not**:

- touch the Portal UI;
- configure Windows Task Scheduler or any other scheduler;
- reconcile the store-level total to Power BI (which includes anomalous
  tickets by design — this feed only ever stores clean, attributed data,
  see `get_vendas_metricas_mtd`'s migration header);
- compute commissions/payroll.
