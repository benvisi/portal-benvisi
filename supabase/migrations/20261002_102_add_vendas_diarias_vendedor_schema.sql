begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A — curated daily aggregates schema.
--
-- Three tables, all additive-daily-ingredients-only (never precomputed
-- period ratios — ticket médio / PA / PM are derived from summed additive
-- columns by the read RPC in 20261002_105). MTD is just SUM() over these
-- tables' rows for the current calendar month — no separate MTD storage.
--
-- vendas_diarias_vendedor — one row per (codigo_filial, data_venda,
-- funcionario_id): CLEAN, mapped salesperson data only. A ticket lands here
-- only if it is valid (not cancelled), resolves to exactly one distinct
-- VENDEDOR (dbo.LOJA_VENDA_VENDEDORES), and that VENDEDOR code has a
-- funcionarios.codigo_vendedor_linx mapping. Never guessed/allocated.
--
-- vendas_diarias_loja — one row per (codigo_filial, data_venda): the
-- STORE-LEVEL total over ALL valid (non-cancelled) tickets, regardless of
-- attribution outcome. This is computed with the exact same
-- computeKpis()/overallKpis logic already validated in
-- scripts/sales-metrics-reconciliation/reconcile-vendas.mjs — the same
-- population that reconciles directly to Power BI for a given
-- filial/period. This table, not a sum of vendas_diarias_vendedor rows, is
-- the authoritative source for the "Total" the Portal shows — "Total" must
-- never be defined as merely the sum of mapped salesperson rows.
--
-- vendas_diarias_anomalias — one row per (codigo_filial, data_venda,
-- categoria), categoria in ('zero_atribuicao', 'multipla_atribuicao',
-- 'nao_mapeado'). Pure operational diagnostics: the additive breakdown of
-- exactly which valid tickets could not be placed in a displayed
-- salesperson row, and why. NOT used to compute the Portal's "Outros" row
-- (that is derived at read time in get_vendas_metricas_mtd as
-- vendas_diarias_loja minus the summed vendas_diarias_vendedor rows, so the
-- displayed invariant salespeople + Outros = Total holds by construction
-- regardless of this table). This table exists only so the residual can be
-- explained by category later if someone asks "why is Outros nonzero
-- today" — it is not itself a displayed row, and never a fake
-- employee/salesperson.
--
-- All three tables: no RLS policies (matches every other table in this
-- schema) — all access is through SECURITY DEFINER RPCs. Written only by
-- the single service-role-only RPC added in 20261002_103, which replaces
-- one (codigo_filial, data_venda) across all three tables atomically.
-- =============================================================================

create table public.vendas_diarias_vendedor (
  id uuid primary key default gen_random_uuid(),
  codigo_filial text not null,
  data_venda date not null,
  funcionario_id uuid not null references public.funcionarios(id),
  codigo_vendedor_linx text not null,
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

create table public.vendas_diarias_loja (
  id uuid primary key default gen_random_uuid(),
  codigo_filial text not null,
  data_venda date not null,
  venda_liquida numeric(14, 2) not null default 0,
  tickets integer not null default 0,
  pecas_brutas integer not null default 0,
  pecas_troca integer not null default 0,
  pecas_liquidas integer generated always as (pecas_brutas - pecas_troca) stored,
  atualizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (codigo_filial, data_venda)
);

create index vendas_diarias_loja_data_idx
  on public.vendas_diarias_loja (data_venda);

alter table public.vendas_diarias_loja enable row level security;

create table public.vendas_diarias_anomalias (
  id uuid primary key default gen_random_uuid(),
  codigo_filial text not null,
  data_venda date not null,
  categoria text not null check (categoria in ('zero_atribuicao', 'multipla_atribuicao', 'nao_mapeado')),
  venda_liquida numeric(14, 2) not null default 0,
  tickets integer not null default 0,
  pecas_brutas integer not null default 0,
  pecas_troca integer not null default 0,
  pecas_liquidas integer generated always as (pecas_brutas - pecas_troca) stored,
  atualizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (codigo_filial, data_venda, categoria)
);

create index vendas_diarias_anomalias_data_idx
  on public.vendas_diarias_anomalias (data_venda);

alter table public.vendas_diarias_anomalias enable row level security;

commit;
