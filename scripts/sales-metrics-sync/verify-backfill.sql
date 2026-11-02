-- =============================================================================
-- Historical backfill — reconciliation checks. READ-ONLY (selects only).
-- Run in the Supabase SQL editor (or execute_sql) before and after the
-- backfill. Filial 060420; adjust if backfilling another filial.
-- Each query is independent — run them one at a time.
-- =============================================================================

-- 1) Coverage. After the backfill: earliest_day = 2023-01-01 (if Linx has
--    sales that early; otherwise the first day Linx has tickets).
select 'loja' as tabela, count(*) as linhas, count(distinct data_venda) as dias,
       min(data_venda) as primeiro_dia, max(data_venda) as ultimo_dia
  from public.vendas_diarias_loja where codigo_filial = '060420'
union all
select 'vendedor', count(*), count(distinct data_venda), min(data_venda), max(data_venda)
  from public.vendas_diarias_vendedor where codigo_filial = '060420'
union all
select 'anomalias', count(*), count(distinct data_venda), min(data_venda), max(data_venda)
  from public.vendas_diarias_anomalias where codigo_filial = '060420';

-- 2) No duplicate day / seller rows (must return zero rows; the unique
--    constraints already guarantee it — this proves it).
select 'loja' as tabela, data_venda::text as chave, count(*) as n
  from public.vendas_diarias_loja
 group by codigo_filial, data_venda having count(*) > 1
union all
select 'vendedor', data_venda::text || ' / ' || funcionario_id::text, count(*)
  from public.vendas_diarias_vendedor
 group by codigo_filial, data_venda, funcionario_id having count(*) > 1;

-- 3) Loja total reconciles to vendedor rows + anomaly categories, per day
--    (Outros = Total - mapped sellers = zero + multiple attribution + unmapped).
--    Must return zero rows.
with v as (
  select data_venda, sum(venda_liquida) vl, sum(tickets) tk, sum(pecas_brutas) pb, sum(pecas_troca) pt
    from public.vendas_diarias_vendedor where codigo_filial = '060420' group by data_venda
), a as (
  select data_venda, sum(venda_liquida) vl, sum(tickets) tk, sum(pecas_brutas) pb, sum(pecas_troca) pt
    from public.vendas_diarias_anomalias where codigo_filial = '060420' group by data_venda
)
select l.data_venda,
       l.venda_liquida - coalesce(v.vl, 0) - coalesce(a.vl, 0) as dif_venda,
       l.tickets - coalesce(v.tk, 0) - coalesce(a.tk, 0) as dif_tickets,
       l.pecas_brutas - coalesce(v.pb, 0) - coalesce(a.pb, 0) as dif_pecas_brutas,
       l.pecas_troca - coalesce(v.pt, 0) - coalesce(a.pt, 0) as dif_pecas_troca
  from public.vendas_diarias_loja l
  left join v using (data_venda)
  left join a using (data_venda)
 where l.codigo_filial = '060420'
   and (l.venda_liquida - coalesce(v.vl, 0) - coalesce(a.vl, 0) <> 0
     or l.tickets - coalesce(v.tk, 0) - coalesce(a.tk, 0) <> 0
     or l.pecas_brutas - coalesce(v.pb, 0) - coalesce(a.pb, 0) <> 0
     or l.pecas_troca - coalesce(v.pt, 0) - coalesce(a.pt, 0) <> 0)
 order by l.data_venda;

-- 4) Known recent days (pre-backfill baseline captured 2026-11-02 — these may
--    differ only by normal ongoing sync/late cancellations):
--      2026-10-31  47978.30  45 tickets  82 brutas  2 trocas  80 liquidas
--      2026-11-01  16646.44  22 tickets  31 brutas  5 trocas  26 liquidas
--      2026-11-02   4139.06   5 tickets   9 brutas  2 trocas   7 liquidas (day in progress)
select data_venda, venda_liquida, tickets, pecas_brutas, pecas_troca, pecas_liquidas
  from public.vendas_diarias_loja
 where codigo_filial = '060420' and data_venda >= '2026-10-31' order by data_venda;

-- 5) Monthly totals, to spot-check against Power BI / the reconciliation tool.
select date_trunc('month', data_venda)::date as mes,
       count(*) as dias_com_venda, sum(venda_liquida) as venda_liquida, sum(tickets) as tickets,
       sum(pecas_liquidas) as pecas_liquidas
  from public.vendas_diarias_loja where codigo_filial = '060420'
 group by 1 order by 1;

-- 6) How much of history lands under "Outros" (unmapped sellers / multi / zero
--    attribution), by category and year.
select extract(year from data_venda)::int as ano, categoria,
       sum(venda_liquida) as venda_liquida, sum(tickets) as tickets
  from public.vendas_diarias_anomalias where codigo_filial = '060420'
 group by 1, 2 order by 1, 2;
