begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A — curated daily aggregates table.
--
-- One row per (codigo_filial, data_venda, funcionario_id) — the data grain
-- decided for this slice: additive daily ingredients only, never precomputed
-- period ratios (ticket médio / PA / PM are derived from the summed additive
-- columns, by the read RPC in 20261002_104). MTD is just SUM() over this
-- table's rows for the current calendar month — no separate MTD storage.
--
-- Measures mirror scripts/sales-metrics-reconciliation/reconcile-vendas.mjs's
-- locked KPI definitions exactly (same grain: valid tickets, i.e.
-- DATA_HORA_CANCELAMENTO IS NULL, attributed via LOJA_VENDA_VENDEDORES
-- resolving to exactly one distinct VENDEDOR):
--   venda_liquida   = SUM(VALOR_PAGO) over valid, resolved tickets
--   tickets         = COUNT(ticket) over valid, resolved tickets
--   pecas_brutas    = SUM(QTDE_TOTAL) over valid, resolved tickets
--   pecas_troca     = SUM(QTDE_TROCA_TOTAL) over valid, resolved tickets
--   pecas_liquidas  = pecas_brutas - pecas_troca (generated column, so it can
--                     never drift from its two inputs)
--
-- Tickets with zero or >1 distinct VENDEDOR (anomalous) and tickets whose
-- resolved VENDEDOR code has no funcionarios.codigo_vendedor_linx mapping
-- are excluded entirely from this table — never guessed/allocated, never
-- force-attributed to a placeholder row. The sync script logs their counts
-- to stdout on every run (acceptance criteria for this slice); this table
-- only ever holds clean, attributed data.
--
-- Written only by the service-role-only RPC added in 20261002_103 (one
-- (codigo_filial, data_venda) replaced per call — see that migration for the
-- idempotency rationale). No RLS policies (matches every other table in this
-- schema) — all access is through SECURITY DEFINER RPCs.
-- =============================================================================

create table public.vendas_diarias_vendedor (
  id uuid primary key default gen_random_uuid(),
  codigo_filial text not null,
  data_venda date not null,
  funcionario_id uuid not null references public.funcionarios(id),
  codigo_vendedor_linx integer not null,
  venda_liquida numeric(14, 2) not null default 0,
  tickets integer not null default 0,
  pecas_brutas integer not null default 0,
  pecas_troca integer not null default 0,
  pecas_liquidas integer generated always as (pecas_brutas - pecas_troca) stored,
  atualizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (codigo_filial, data_venda, funcionario_id)
);

create index vendas_diarias_vendedor_data_idx
  on public.vendas_diarias_vendedor (data_venda);
create index vendas_diarias_vendedor_funcionario_data_idx
  on public.vendas_diarias_vendedor (funcionario_id, data_venda);

alter table public.vendas_diarias_vendedor enable row level security;

commit;
