# Salesperson Metrics — production sync (Slice A)

Publishes curated daily salesperson sales aggregates from Linx to Supabase
(`public.vendas_diarias_vendedor`, `public.vendas_diarias_loja`,
`public.vendas_diarias_anomalias`), for the Portal to read later via the
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
4. Computes the store-level day total with the exact same `computeKpis()` /
   `overallKpis` logic the reconciliation tool already validated against
   Power BI — over ALL valid tickets, regardless of attribution outcome.
5. Writes the day's rows via `vendas_diarias_substituir_dia` — one
   transaction that deletes and re-inserts that day's full row set across
   all three tables, so reruns are idempotent even if attribution for the
   day changed since the last run (e.g. a late cancellation).

`VENDEDOR` codes are **text**, never numbers, throughout this pipeline —
verified against the live Linx schema (`dbo.LOJA_VENDA_VENDEDORES.VENDEDOR`
is `CHAR(4)`), not inferred from sample data. Coercing to a number would
silently corrupt any future leading-zero code.

### Total vs. Outros vs. salesperson rows

The Portal's `get_vendas_metricas_mtd` RPC (not this script) derives three
kinds of rows for the UI:

- **Total** = `SUM()` of `vendas_diarias_loja` for the period — the
  store-level figure this script computed above. Never the sum of mapped
  salesperson rows.
- **Salesperson rows** = `SUM()` of `vendas_diarias_vendedor`, grouped by
  `funcionario_id` — clean, mapped data only.
- **Outros** = `Total − SUM(salesperson rows)`, computed elementwise per
  additive metric, at read time, in the RPC. This guarantees
  `SUM(salesperson rows) + Outros = Total` by construction and is never a
  stored fake employee/salesperson row. The RPC omits the Outros row
  entirely when every residual metric is exactly zero.

Three categories of valid ticket feed that residual and are **excluded**
from the salesperson rows — never guessed/allocated, and reported to stdout
every run plus published (for diagnosis only, not for computing Outros) to
`vendas_diarias_anomalias`:

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
will simply show up in the "UNMAPPED" log lines until mapped, and their
sales fall into the Outros residual instead.

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

Every run logs, per day: rows examined/valid/cancelled, store-level total,
zero/multi attribution anomaly counts, mapped/unmapped vendedor counts (with
each unmapped code/name/value listed), a preview of what the Outros residual
would be (and whether it would be shown or omitted), the Linx query
duration, and the total sync duration — use these numbers to decide the real
scheduling interval (5-minute vs. 1-minute) later. **No Task Scheduler
wiring is part of this slice** — invoke manually (or via whatever ad-hoc
mechanism you choose) until that decision is made.

## Historical backfill (manual, one-off)

[`backfill-vendas-diarias.mjs`](backfill-vendas-diarias.mjs) fills the daily
aggregates for an explicit date range (e.g. 2023-01-01 → today) so the
Relatório de vendas period selector (Mês / Ano / Últimos 12 meses) has history.
It is **not** run by the 5-minute scheduled task and must not be scheduled.

It reuses this script's day processing verbatim (`processDayRows`: same Linx
query, ticket classification, KPI math, `codigo_vendedor_linx` mapping and
`vendas_diarias_substituir_dia` write). The only difference is batching: one
read-only Linx query per **calendar month** (the ticket rows carry `DATA_VENDA`
and are split by day in memory) instead of one per day — 47 Linx queries for
2023-01-01 → 2026-11-02 instead of ~1,400. Roughly one write RPC per day with
sales (~1,400 small calls). Nothing transaction-level is stored.

```sh
# 1) Preview — reads Linx + the vendor mapping, writes nothing
node scripts/sales-metrics-sync/backfill-vendas-diarias.mjs --from 2023-01-01 --to 2026-11-02 --dry-run

# 2) Real run
node scripts/sales-metrics-sync/backfill-vendas-diarias.mjs --from 2023-01-01 --to 2026-11-02
```

- `--from` and `--to` (inclusive, `YYYY-MM-DD`) are mandatory; `--to` cannot be
  in the future (Manaus date). `--filial` defaults to `060420`.
- Idempotent: each day is replaced as a whole, so rerunning any range creates
  no duplicates, and it is safe to run while the 5-minute sync is running.
- Resumable: on failure it prints the exact command to rerun, starting from the
  failed month (`--from <month start>`).
- Days with no Linx tickets are not written (counted as "empty days").
- End-of-run summary: Linx queries, ticket rows, days written, earliest day with
  data, and every `VENDEDOR` code that still has no `funcionarios.codigo_vendedor_linx`
  mapping (those sales appear under **Outros**; map historical sellers first if
  they should show by name).
- Exit codes: `1` failure (resume as printed), `3` some days were skipped for a
  duplicate-key invariant violation (not written; investigate).

Validate with [`verify-backfill.sql`](verify-backfill.sql) (read-only) and, after
applying the period migration, [`verify-periodos.sql`](verify-periodos.sql).

## Tests

```sh
node scripts/sales-metrics-sync/test-sync-vendas-diarias.mjs
node scripts/sales-metrics-sync/test-backfill-vendas-diarias.mjs
```

Covers this script's own added logic: Manaus date windowing, CLI parsing,
text-based mapping resolution (including leading-zero codes), and an
end-to-end fixture exercising every ticket category (mapped, zero-
attribution, multi-attribution, unmapped, cancelled) that asserts the
`SUM(salesperson rows) + Outros = Total` invariant and the ratio/omission
rules for Outros. The underlying classification/KPI logic it reuses is
covered by
[`test-reconcile-vendas.mjs`](../sales-metrics-reconciliation/test-reconcile-vendas.mjs).

## Stopping point (locked scope for this slice)

Deliberately does **not**:

- touch the Portal UI;
- configure Windows Task Scheduler or any other scheduler;
- compute commissions/payroll.

`Total` in `get_vendas_metricas_mtd` DOES reconcile to the same population
Power BI's store-level report uses (all valid tickets for the
filial/period) — see that migration's header for the exact equivalence.
