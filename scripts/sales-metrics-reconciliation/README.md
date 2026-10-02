# Salesperson Metrics — dry-run Linx reconciliation

A read-only, Supabase-free reconciliation tool. It proves we can derive the
intended Portal salesperson KPIs correctly from Linx **before** any Supabase
schema/sync/UI work is designed. This is the first implementation slice of
the Salesperson Metrics initiative — it ends here; see "Stopping point"
below.

## What it does

1. Runs a single `SELECT` against Linx SQL Server
   ([`linx-vendas-query.sql`](./linx-vendas-query.sql)): one row per
   `(CODIGO_FILIAL, TICKET, DATA_VENDA)` from `dbo.LOJA_VENDA`, joined to a
   `DISTINCT`-collapsed responsible-salesperson attribution from
   `dbo.LOJA_VENDA_VENDEDORES`, plus the salesperson's display name/apelido
   from `dbo.LOJA_VENDEDORES` when attribution resolved cleanly.
2. Classifies every ticket locally (`reconcile-vendas.mjs`):
   - valid vs. cancelled (`DATA_HORA_CANCELAMENTO IS NULL`);
   - zero-attribution anomaly (no `LOJA_VENDA_VENDEDORES` row at all);
   - multi-attribution anomaly (>1 distinct `VENDEDOR` for the ticket);
   - duplicate canonical-key violations (the `(filial, ticket, data_venda)`
     grain turning out not to be unique for the requested period/filial).
3. Computes the locked KPI set (venda líquida, tickets válidos, peças
   brutas/troca/líquidas, ticket médio, PA, PM) — once for the whole
   store/period, and once per cleanly-resolved salesperson.
4. Prints a human-readable console report. **No Supabase calls. No writes
   of any kind, to Linx or anywhere else.**

Anomalous tickets (zero or >1 distinct salesperson) are **never** split,
duplicated, or arbitrarily assigned — they are counted and excluded from the
per-salesperson breakdown, but still counted in the overall/store-level
totals (which is what should reconcile directly to Power BI).

## Setup

The `mssql` driver is already a devDependency in the repo root
`package.json` — run `npm install` at the repo root first if
`node_modules/mssql` isn't present yet.

```sh
cp scripts/sales-metrics-reconciliation/.env.example scripts/sales-metrics-reconciliation/.env
# then fill in LINX_SQL_PASSWORD (and LINX_SQL_USER if not using sa)
```

## Run

```sh
node scripts/sales-metrics-reconciliation/reconcile-vendas.mjs \
  --start 2026-09-01 --end 2026-09-30 \
  [--filial 060420]      # defaults to 060420, the V1/test filial
```

`--start`/`--end` are **inclusive** calendar dates (`YYYY-MM-DD`); the tool
converts them internally to the half-open range
`DATA_VENDA >= start AND DATA_VENDA < end+1day` passed to SQL Server. No
timezone conversion is applied to `DATA_VENDA` — it is compared as the plain
calendar date Linx stores it as.

## Tests

Pure-function fixture tests (classification, KPI math, anomaly detection, CLI
parsing, the read-only SQL guard) — no Linx connection required:

```sh
node scripts/sales-metrics-reconciliation/test-reconcile-vendas.mjs
```

## Comparing against Power BI

Existing Power BI filtering uses `LOJA_VENDA.VENDEDOR` for salesperson
attribution. This tool intentionally uses `LOJA_VENDA_VENDEDORES` instead
(the attribution source used in payroll — see the Salesperson Metrics
discovery report for why). Because of this:

- the **overall/store-level** KPI block should reconcile directly to Power
  BI for the same filial + date range (both ultimately read `LOJA_VENDA`,
  just with/without the Power Query/DAX layer in between);
- the **per-salesperson** KPI blocks may legitimately differ from whatever
  Power BI shows filtered by vendor, because the two reports use different
  attribution tables. A difference here is a signal to investigate, not a
  bug in this tool — do not change Portal's attribution source just to force
  parity with Power BI's.

To compare manually in Power BI Desktop: filter the report to
`CODIGO_FILIAL = <same filial>` and `DATA_VENDA` within the same inclusive
date range used on the command line, and read off venda líquida / tickets
válidos / peças líquidas / ticket médio / PA / PM for the same period.

## Stopping point (locked scope for this slice)

This tool is the entire first implementation slice. It deliberately does
**not**:

- write anything to Supabase, or define any Supabase schema/migration;
- implement the production Linx → Supabase sync or its scheduling;
- implement the `funcionarios` ↔ Linx `VENDEDOR` identity mapping;
- compute or infer commission/payroll amounts;
- touch the Portal UI.

Those are later, separate slices once this tool's reconciliation output has
been reviewed against Power BI for a real period.
