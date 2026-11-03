-- =============================================================================
-- Post-migration check for 20261102_102_add_vendas_comparativo_periodo_rpc.sql.
-- READ-ONLY (selects only). Run in the Supabase SQL editor (or execute_sql)
-- AFTER the migration is applied. Every row must show ok = true.
--
-- resolver_janelas_comparativo is an internal helper (not granted to anon), so
-- it is called here as the database owner with fixed reference dates. Each
-- expectation lists the windows oldest -> newest as
--   'inicio..fim' (anos_atras 3, 2, 1, 0).
-- 2026-11-19 is a Thursday; 2024-02-29 is a Thursday; 2026-01-01 is a Thursday.
-- =============================================================================

with casos(nome, periodo, incluir_hoje, hoje, esperado) as (values
  -- HOJE: nearest same weekday per year (never the blind calendar date)
  ('hoje sim 11-19',   'hoje', true,  '2026-11-19',
     '2023-11-16..2023-11-16|2024-11-21..2024-11-21|2025-11-20..2025-11-20|2026-11-19..2026-11-19'),
  ('hoje nao 11-19',   'hoje', false, '2026-11-19',
     '2023-11-15..2023-11-15|2024-11-20..2024-11-20|2025-11-19..2025-11-19|2026-11-18..2026-11-18'),
  -- year boundary: the 2023 row lands in December 2022
  ('hoje sim 01-01',   'hoje', true,  '2026-01-01',
     '2022-12-29..2022-12-29|2024-01-04..2024-01-04|2025-01-02..2025-01-02|2026-01-01..2026-01-01'),
  -- leap day anchor (Thursday)
  ('hoje sim 02-29',   'hoje', true,  '2024-02-29',
     '2021-02-25..2021-02-25|2022-03-03..2022-03-03|2023-03-02..2023-03-02|2024-02-29..2024-02-29'),
  -- MES: same accumulated days
  ('mes sim 11-19',    'mes',  true,  '2026-11-19',
     '2023-11-01..2023-11-19|2024-11-01..2024-11-19|2025-11-01..2025-11-19|2026-11-01..2026-11-19'),
  ('mes nao 11-19',    'mes',  false, '2026-11-19',
     '2023-11-01..2023-11-18|2024-11-01..2024-11-18|2025-11-01..2025-11-18|2026-11-01..2026-11-18'),
  ('mes sim 02-29',    'mes',  true,  '2024-02-29',
     '2021-02-01..2021-02-28|2022-02-01..2022-02-28|2023-02-01..2023-02-28|2024-02-01..2024-02-29'),
  -- first of month with Nao: current window is the whole previous month
  ('mes nao 11-01',    'mes',  false, '2026-11-01',
     '2023-10-01..2023-10-31|2024-10-01..2024-10-31|2025-10-01..2025-10-31|2026-10-01..2026-10-31'),
  -- ANO: Jan 1 -> same calendar date
  ('ano sim 11-19',    'ano',  true,  '2026-11-19',
     '2023-01-01..2023-11-19|2024-01-01..2024-11-19|2025-01-01..2025-11-19|2026-01-01..2026-11-19'),
  ('ano nao 11-19',    'ano',  false, '2026-11-19',
     '2023-01-01..2023-11-18|2024-01-01..2024-11-18|2025-01-01..2025-11-18|2026-01-01..2026-11-18'),
  ('ano sim 02-29',    'ano',  true,  '2024-02-29',
     '2021-01-01..2021-02-28|2022-01-01..2022-02-28|2023-01-01..2023-02-28|2024-01-01..2024-02-29'),
  ('ano nao 01-01',    'ano',  false, '2026-01-01',
     '2022-01-01..2022-12-31|2023-01-01..2023-12-31|2024-01-01..2024-12-31|2025-01-01..2025-12-31'),
  -- ULTIMOS 12 MESES: V1.1 rolling rule at each shifted end date
  ('12m sim 11-19',    'ultimos_12_meses', true,  '2026-11-19',
     '2022-11-20..2023-11-19|2023-11-20..2024-11-19|2024-11-20..2025-11-19|2025-11-20..2026-11-19'),
  ('12m nao 11-19',    'ultimos_12_meses', false, '2026-11-19',
     '2022-11-19..2023-11-18|2023-11-19..2024-11-18|2024-11-19..2025-11-18|2025-11-19..2026-11-18'),
  ('12m sim 02-29',    'ultimos_12_meses', true,  '2024-02-29',
     '2020-02-29..2021-02-28|2021-03-01..2022-02-28|2022-03-01..2023-02-28|2023-03-01..2024-02-29')
), resolvido as (
  select c.nome, c.esperado,
         string_agg(j.data_inicio || '..' || j.data_fim, '|' order by j.anos_atras desc) as obtido
  from casos c
  cross join lateral public.resolver_janelas_comparativo(c.periodo, c.incluir_hoje, c.hoje::date) j
  group by c.nome, c.esperado
)
select nome, obtido, (obtido = esperado) as ok from resolvido order by nome;

-- Hoje: every window must fall on the SAME WEEKDAY as the anchor.
select c.hoje, j.anos_atras, j.data_fim,
       (extract(isodow from j.data_fim) = extract(isodow from c.hoje::date)) as ok
from (values ('2026-11-19'), ('2026-01-01'), ('2024-02-29'), ('2025-03-31')) as c(hoje)
cross join lateral public.resolver_janelas_comparativo('hoje', true, c.hoje::date) j
order by c.hoje, j.anos_atras desc;

-- The current window equals the V1.1 period resolver (Incluir hoje = Sim).
select p.periodo, (a.data_inicio = b.data_inicio and a.data_fim = b.data_fim) as ok
from (values ('hoje'), ('mes'), ('ano'), ('ultimos_12_meses')) as p(periodo)
cross join lateral public.resolver_janelas_comparativo(p.periodo, true, '2026-11-19'::date) a
cross join lateral public.resolver_periodo_vendas(p.periodo, '2026-11-19'::date) b
where a.anos_atras = 0;

-- Invalid input must be rejected. Run each of these ON ITS OWN; each must
-- fail with P0001:
--   select * from public.resolver_janelas_comparativo('semana', true);   -- PERIODO_INVALIDO
--   select * from public.resolver_janelas_comparativo('mes', null);      -- INCLUIR_HOJE_INVALIDO
--   select * from public.resolver_janelas_comparativo('mes', true, current_date, 0);  -- ANOS_INVALIDO

-- Ratios come from summed bases: compare against a direct SUM over the same
-- windows (Incluir hoje = Sim). All four rows must show ok = true.
select j.anos_atras, j.data_inicio, j.data_fim,
       (m.venda_liquida = d.venda and m.tickets = d.tickets and m.pecas_liquidas = d.liquidas
        and (m.pa is not distinct from case when d.tickets = 0 then null else d.liquidas::numeric / d.tickets end)
        and (m.ticket_medio is not distinct from case when d.tickets = 0 then null else d.venda / d.tickets end)
        and (m.pm is not distinct from case when d.liquidas = 0 then null else d.venda / d.liquidas end)) as ok
from public.resolver_janelas_comparativo('ano', true) j
cross join lateral (
  select * from public.vendas_metricas_intervalo('060420', j.data_inicio, j.data_fim) where eh_total
) m
cross join lateral (
  select coalesce(sum(venda_liquida), 0) as venda, coalesce(sum(tickets), 0) as tickets,
         coalesce(sum(pecas_liquidas), 0) as liquidas
  from public.vendas_diarias_loja
  where codigo_filial = '060420' and data_venda between j.data_inicio and j.data_fim
) d
order by j.anos_atras desc;
