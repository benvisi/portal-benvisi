begin;

-- =============================================================================
-- Relatório de vendas — period selector (Hoje | Mês | Ano | Últimos 12 meses).
--
-- Forward migration on top of 20261002_106 (already deployed — never edited in
-- place). get_vendas_metricas_mtd stays untouched and callable
-- (backward compatible); this migration adds three functions, layered so that
-- period resolution is isolated from metric aggregation:
--
--   1. public.resolver_periodo_vendas(p_periodo, p_hoje)
--        PERIOD RESOLUTION ONLY. Maps a validated period key to an inclusive
--        [data_inicio, data_fim] date range on the Manaus business calendar.
--        No table access.
--
--   2. public.vendas_metricas_intervalo(p_codigo_filial, p_data_inicio,
--                                       p_data_fim)
--        METRIC AGGREGATION ONLY, over any inclusive date range. This is the
--        exact get_vendas_metricas_mtd (106) calculation with v_inicio/v_fim
--        turned into parameters: Total = SUM(vendas_diarias_loja), salesperson
--        rows = SUM(vendas_diarias_vendedor) per funcionario, Outros = Total
--        minus mapped salespeople (omitted when every residual is zero), and
--        PA / Ticket médio / PM derived from the summed additive columns —
--        never an average of daily ratios. A future period-over-period report
--        calls this same function once per resolved window.
--
--   3. public.get_vendas_metricas_periodo(p_session_token, p_periodo,
--                                         p_codigo_filial)
--        The ONLY browser-facing function. Validates the session, enforces
--        Gerente/Administrador from the server-side session context (same
--        check as 106), validates p_periodo against the four allowed keys,
--        resolves the range and delegates to (2). The browser never supplies
--        dates or a role.
--
-- Period keys and Manaus-calendar ranges (today = Manaus business date):
--   hoje              [today, today]
--   mes               [first day of the current month, today]
--   ano               [January 1 of the current year, today]
--   ultimos_12_meses  [(today - 12 months) + 1 day, today] — a rolling window
--                     of 12 calendar months ending today (calendar-date
--                     arithmetic, so leap years follow naturally; the previous
--                     12-month window ends the day before data_inicio).
--
-- Grants: (1) and (2) are internal helpers — no grant to anon / authenticated /
-- service_role (revoked from PUBLIC); they run inside (3), which is SECURITY
-- DEFINER. (3) is granted to anon only, as in 105/106: the browser uses the
-- anon key and the employee session token is the real credential.
-- =============================================================================

-- 1) Period resolution (pure; p_hoje is overridable only so the rules can be
--    verified for fixed reference dates — get_vendas_metricas_periodo never
--    passes it, so the browser cannot influence it).
create or replace function public.resolver_periodo_vendas(
  p_periodo text,
  p_hoje date default (now() at time zone 'America/Manaus')::date
)
returns table (
  data_inicio date,
  data_fim date
)
language plpgsql
stable
set search_path = public
as $$
begin
  if p_periodo is null or p_periodo not in ('hoje', 'mes', 'ano', 'ultimos_12_meses') then
    raise exception using errcode = 'P0001', message = 'PERIODO_INVALIDO';
  end if;

  data_fim := p_hoje;
  data_inicio := case p_periodo
    when 'hoje' then p_hoje
    when 'mes' then date_trunc('month', p_hoje)::date
    when 'ano' then date_trunc('year', p_hoje)::date
    when 'ultimos_12_meses' then ((p_hoje - interval '12 months') + interval '1 day')::date
  end;
  return next;
end;
$$;

revoke all on function public.resolver_periodo_vendas(text, date) from public, anon, authenticated, service_role;

-- 2) Metric aggregation over an inclusive date range.
create or replace function public.vendas_metricas_intervalo(
  p_codigo_filial text,
  p_data_inicio date,
  p_data_fim date
)
returns table (
  funcionario_id uuid,
  vendedor_nome text,
  eh_outros boolean,
  eh_total boolean,
  venda_liquida numeric,
  tickets integer,
  pecas_brutas integer,
  pecas_troca integer,
  pecas_liquidas integer,
  ticket_medio numeric,
  pa numeric,
  pm numeric,
  atualizado_em timestamptz
)
language plpgsql
stable
set search_path = public
as $$
begin
  return query
    with periodo_vendedor as (
      select v.*
      from public.vendas_diarias_vendedor v
      where v.codigo_filial = p_codigo_filial
        and v.data_venda >= p_data_inicio
        and v.data_venda <= p_data_fim
    ),
    por_vendedor as (
      select
        p.funcionario_id,
        coalesce(f.apelido, f.nome)::text as vendedor_nome,
        false as eh_outros,
        false as eh_total,
        sum(p.venda_liquida)::numeric as venda_liquida,
        sum(p.tickets)::integer as tickets,
        sum(p.pecas_brutas)::integer as pecas_brutas,
        sum(p.pecas_troca)::integer as pecas_troca,
        sum(p.pecas_liquidas)::integer as pecas_liquidas,
        max(p.atualizado_em) as atualizado_em
      from periodo_vendedor p
      join public.funcionarios f on f.id = p.funcionario_id
      group by p.funcionario_id, f.apelido, f.nome
    ),
    mapeados_totais as (
      select
        coalesce(sum(pv.venda_liquida), 0)::numeric as venda_liquida,
        coalesce(sum(pv.tickets), 0)::integer as tickets,
        coalesce(sum(pv.pecas_brutas), 0)::integer as pecas_brutas,
        coalesce(sum(pv.pecas_troca), 0)::integer as pecas_troca,
        coalesce(sum(pv.pecas_liquidas), 0)::integer as pecas_liquidas,
        max(pv.atualizado_em) as atualizado_em
      from por_vendedor pv
    ),
    loja_totais as (
      select
        coalesce(sum(vdl.venda_liquida), 0)::numeric as venda_liquida,
        coalesce(sum(vdl.tickets), 0)::integer as tickets,
        coalesce(sum(vdl.pecas_brutas), 0)::integer as pecas_brutas,
        coalesce(sum(vdl.pecas_troca), 0)::integer as pecas_troca,
        coalesce(sum(vdl.pecas_liquidas), 0)::integer as pecas_liquidas,
        max(vdl.atualizado_em) as atualizado_em
      from public.vendas_diarias_loja vdl
      where vdl.codigo_filial = p_codigo_filial
        and vdl.data_venda >= p_data_inicio
        and vdl.data_venda <= p_data_fim
    ),
    outros as (
      select
        null::uuid as funcionario_id,
        'Outros'::text as vendedor_nome,
        true as eh_outros,
        false as eh_total,
        (loja.venda_liquida - mapeados.venda_liquida) as venda_liquida,
        (loja.tickets - mapeados.tickets) as tickets,
        (loja.pecas_brutas - mapeados.pecas_brutas) as pecas_brutas,
        (loja.pecas_troca - mapeados.pecas_troca) as pecas_troca,
        (loja.pecas_liquidas - mapeados.pecas_liquidas) as pecas_liquidas,
        greatest(loja.atualizado_em, mapeados.atualizado_em) as atualizado_em
      from loja_totais loja, mapeados_totais mapeados
      where (loja.venda_liquida - mapeados.venda_liquida) <> 0
         or (loja.tickets - mapeados.tickets) <> 0
         or (loja.pecas_brutas - mapeados.pecas_brutas) <> 0
         or (loja.pecas_troca - mapeados.pecas_troca) <> 0
         or (loja.pecas_liquidas - mapeados.pecas_liquidas) <> 0
    ),
    total as (
      select
        null::uuid as funcionario_id,
        'Total da loja'::text as vendedor_nome,
        false as eh_outros,
        true as eh_total,
        loja.venda_liquida,
        loja.tickets,
        loja.pecas_brutas,
        loja.pecas_troca,
        loja.pecas_liquidas,
        loja.atualizado_em
      from loja_totais loja
    )
    select
      c.funcionario_id,
      c.vendedor_nome,
      c.eh_outros,
      c.eh_total,
      c.venda_liquida,
      c.tickets,
      c.pecas_brutas,
      c.pecas_troca,
      c.pecas_liquidas,
      case when c.tickets = 0 then null else c.venda_liquida / c.tickets end as ticket_medio,
      case when c.tickets = 0 then null else c.pecas_liquidas::numeric / c.tickets end as pa,
      case when c.pecas_liquidas = 0 then null else c.venda_liquida / c.pecas_liquidas end as pm,
      c.atualizado_em
    from (
      select * from por_vendedor
      union all
      select * from outros
      union all
      select * from total
    ) c
    order by c.eh_total asc, c.eh_outros asc, c.venda_liquida desc;
end;
$$;

revoke all on function public.vendas_metricas_intervalo(text, date, date) from public, anon, authenticated, service_role;

-- 3) Browser-facing period RPC.
create or replace function public.get_vendas_metricas_periodo(
  p_session_token text,
  p_periodo text,
  p_codigo_filial text default '060420'
)
returns table (
  funcionario_id uuid,
  vendedor_nome text,
  eh_outros boolean,
  eh_total boolean,
  venda_liquida numeric,
  tickets integer,
  pecas_brutas integer,
  pecas_troca integer,
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
  v_inicio date;
  v_fim date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  -- Relatório de vendas is Gerente/Administrador only. The cargo comes from
  -- the validated server-side session context (the database row), never from
  -- anything the browser sends.
  if v_ctx.cargo is null or v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_VENDAS_RELATORIO';
  end if;

  -- Raises PERIODO_INVALIDO for anything but the four allowed keys.
  select r.data_inicio, r.data_fim
    into v_inicio, v_fim
    from public.resolver_periodo_vendas(p_periodo) r;

  return query
    select * from public.vendas_metricas_intervalo(p_codigo_filial, v_inicio, v_fim);
end;
$$;

revoke all on function public.get_vendas_metricas_periodo(text, text, text) from public;
grant execute on function public.get_vendas_metricas_periodo(text, text, text) to anon;

commit;
