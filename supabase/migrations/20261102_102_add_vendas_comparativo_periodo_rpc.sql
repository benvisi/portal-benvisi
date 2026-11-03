begin;

-- =============================================================================
-- Relatório de vendas V1.2 — store-level multi-year comparison.
--
-- Forward migration on top of 20261102_101 (already deployed — never edited in
-- place). get_vendas_metricas_periodo / vendas_metricas_intervalo /
-- resolver_periodo_vendas stay untouched; this adds two layers:
--
--   1. public.resolver_janelas_comparativo(p_periodo, p_incluir_hoje, p_hoje,
--                                          p_anos)
--        WINDOW RESOLUTION ONLY (no table access). For one of the four period
--        keys it returns p_anos inclusive date windows, oldest first:
--        anos_atras = p_anos-1 ... 0 (0 = the current window).
--
--   2. public.get_vendas_comparativo_periodo(p_session_token, p_periodo,
--                                            p_incluir_hoje, p_codigo_filial)
--        The ONLY browser-facing function. Same session + Gerente/
--        Administrador check as get_vendas_metricas_periodo, then one store
--        total per window, taken from vendas_metricas_intervalo (the exact
--        validated 106 aggregation — its "Total da loja" row), so metric
--        definitions are not duplicated: bases are summed first and
--        ticket médio / PA / PM are derived from the summed bases.
--
-- ANCHOR DAY
--   Incluir hoje = Sim -> anchor = Manaus business date (today).
--   Incluir hoje = Não -> anchor = yesterday.
--   (If yesterday falls in the previous month/year, "mes"/"ano" follow the
--   anchor: on the 1st with Não the current window is the whole previous
--   month / year.)
--   Historical windows come from fully synced days; the current window simply
--   holds whatever the daily aggregate has (today's partial total when Sim).
--
-- WINDOWS (k = anos_atras, shifted = anchor - k calendar years; Postgres
-- clamps Feb 29 -> Feb 28 in non-leap years):
--   hoje              the day with the SAME WEEKDAY as the anchor that is
--                     closest to `shifted` (offset -3..+3 days, so it never
--                     drifts away from the calendar date and is unique).
--   mes               [first day of shifted's month, shifted]
--   ano               [January 1 of shifted's year, shifted]
--   ultimos_12_meses  [(shifted - 12 months) + 1 day, shifted] — the V1.1
--                     rolling rule applied to each shifted end date.
--
-- Grants: the resolver is an internal helper (revoked from everyone); the RPC
-- is granted to anon only, as in 105/106/101 (the session token is the real
-- credential). The browser sends only the period key and the toggle — never a
-- date or a role.
-- =============================================================================

create or replace function public.resolver_janelas_comparativo(
  p_periodo text,
  p_incluir_hoje boolean,
  p_hoje date default (now() at time zone 'America/Manaus')::date,
  p_anos integer default 4
)
returns table (
  anos_atras integer,
  data_inicio date,
  data_fim date
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_ancora date;
  v_k integer;
  v_deslocada date;
  v_diff integer;
begin
  if p_periodo is null or p_periodo not in ('hoje', 'mes', 'ano', 'ultimos_12_meses') then
    raise exception using errcode = 'P0001', message = 'PERIODO_INVALIDO';
  end if;
  if p_incluir_hoje is null then
    raise exception using errcode = 'P0001', message = 'INCLUIR_HOJE_INVALIDO';
  end if;
  if p_anos is null or p_anos < 1 or p_anos > 10 then
    raise exception using errcode = 'P0001', message = 'ANOS_INVALIDO';
  end if;

  v_ancora := case when p_incluir_hoje then p_hoje else p_hoje - 1 end;

  for v_k in reverse (p_anos - 1)..0 loop
    v_deslocada := (v_ancora - make_interval(years => v_k))::date;
    anos_atras := v_k;

    if p_periodo = 'hoje' then
      -- weekday distance in 0..6, folded to -3..+3 (nearest same weekday)
      v_diff := (((extract(isodow from v_ancora)::integer - extract(isodow from v_deslocada)::integer) % 7) + 7) % 7;
      data_fim := v_deslocada + (((v_diff + 3) % 7) - 3);
      data_inicio := data_fim;
    elsif p_periodo = 'mes' then
      data_fim := v_deslocada;
      data_inicio := date_trunc('month', v_deslocada)::date;
    elsif p_periodo = 'ano' then
      data_fim := v_deslocada;
      data_inicio := date_trunc('year', v_deslocada)::date;
    else
      data_fim := v_deslocada;
      data_inicio := ((v_deslocada - interval '12 months') + interval '1 day')::date;
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function public.resolver_janelas_comparativo(text, boolean, date, integer) from public, anon, authenticated, service_role;

create or replace function public.get_vendas_comparativo_periodo(
  p_session_token text,
  p_periodo text,
  p_incluir_hoje boolean default true,
  p_codigo_filial text default '060420'
)
returns table (
  anos_atras integer,
  data_inicio date,
  data_fim date,
  venda_liquida numeric,
  tickets integer,
  pecas_liquidas integer,
  ticket_medio numeric,
  pa numeric,
  pm numeric,
  atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  -- Gerente/Administrador only; cargo comes from the validated server-side
  -- session context, never from the browser.
  if v_ctx.cargo is null or v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_VENDAS_RELATORIO';
  end if;

  -- Raises PERIODO_INVALIDO / INCLUIR_HOJE_INVALIDO for bad input.
  return query
    select
      j.anos_atras,
      j.data_inicio,
      j.data_fim,
      t.venda_liquida,
      t.tickets,
      t.pecas_liquidas,
      t.ticket_medio,
      t.pa,
      t.pm,
      t.atualizado_em
    from public.resolver_janelas_comparativo(p_periodo, p_incluir_hoje) j
    cross join lateral (
      select m.*
      from public.vendas_metricas_intervalo(p_codigo_filial, j.data_inicio, j.data_fim) m
      where m.eh_total
    ) t
    order by j.anos_atras desc;
end;
$$;

revoke all on function public.get_vendas_comparativo_periodo(text, text, boolean, text) from public;
grant execute on function public.get_vendas_comparativo_periodo(text, text, boolean, text) to anon;

commit;
