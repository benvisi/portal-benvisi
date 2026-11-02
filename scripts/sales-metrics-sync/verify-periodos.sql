-- =============================================================================
-- Post-migration check for 20261102_101_add_vendas_metricas_periodo_rpc.sql.
-- READ-ONLY (selects only). Run in the Supabase SQL editor (or execute_sql)
-- AFTER the migration is applied. Every row must show ok = true.
--
-- resolver_periodo_vendas is an internal helper (not granted to anon), so it is
-- called here as the database owner with fixed reference dates; the browser
-- RPC never accepts a date.
-- =============================================================================

select t.periodo,
       t.hoje,
       r.data_inicio,
       r.data_fim,
       (r.data_inicio = t.esperado_inicio::date and r.data_fim = t.esperado_fim::date) as ok
from (values
  -- periodo,            hoje,         esperado_inicio, esperado_fim
  ('hoje',             '2026-11-02', '2026-11-02',    '2026-11-02'),
  ('mes',              '2026-11-02', '2026-11-01',    '2026-11-02'),
  ('ano',              '2026-11-02', '2026-01-01',    '2026-11-02'),
  ('ultimos_12_meses', '2026-11-02', '2025-11-03',    '2026-11-02'),
  -- first day of month / year
  ('mes',              '2026-01-01', '2026-01-01',    '2026-01-01'),
  ('ultimos_12_meses', '2026-01-01', '2025-01-02',    '2026-01-01'),
  -- year end
  ('ultimos_12_meses', '2026-12-31', '2026-01-01',    '2026-12-31'),
  -- leap day: 12 calendar months back from 2024-02-29 clamps to 2023-02-28
  ('ultimos_12_meses', '2024-02-29', '2023-03-01',    '2024-02-29'),
  -- window that contains a leap day (366 days)
  ('ultimos_12_meses', '2025-02-28', '2024-02-29',    '2025-02-28'),
  -- month-end clamp
  ('ultimos_12_meses', '2025-03-31', '2024-04-01',    '2025-03-31')
) as t(periodo, hoje, esperado_inicio, esperado_fim)
cross join lateral public.resolver_periodo_vendas(t.periodo, t.hoje::date) r;

-- Default "today" is the Manaus business date (UTC-4), not the UTC date.
select public.resolver_periodo_vendas('hoje') as hoje_manaus,
       (now() at time zone 'America/Manaus')::date as esperado;

-- Invalid periods must be rejected. Run each of these ON ITS OWN; each must
-- fail with P0001 / PERIODO_INVALIDO:
--   select * from public.resolver_periodo_vendas('semana');
--   select * from public.resolver_periodo_vendas(null);
