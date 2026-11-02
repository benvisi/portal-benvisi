begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A — authenticated MTD read RPC.
--
-- public.get_vendas_metricas_mtd(p_session_token, p_codigo_filial) returns,
-- for the future UI table (Vendedor | R$ | Ticket médio | PA | PM | Tickets
-- | Peças | Trocas | Peças líquidas):
--   1. one row per salesperson with at least one vendas_diarias_vendedor
--      row this calendar month (eh_total = false, eh_outros = false);
--   2. one "Outros" row (eh_outros = true) — ONLY when at least one of its
--      residual additive metrics is nonzero;
--   3. one "Total" row (eh_total = true).
--
-- TOTAL = SUM() over vendas_diarias_loja for the period — the store-level,
-- all-valid-tickets figure computed by the sync with the same
-- computeKpis()/overallKpis logic reconcile-vendas.mjs already validated
-- against Power BI. Total is NEVER the sum of the displayed salesperson
-- rows.
--
-- OUTROS = Total minus the SUM of the displayed (mapped) salesperson rows,
-- computed elementwise per additive metric, here, at read time. This
-- guarantees, by construction, for every additive metric:
--     SUM(displayed salesperson rows) + Outros = Total
-- regardless of how the residual breaks down internally. The detailed
-- "why" (zero-attribution / multi-attribution / unmapped-code breakdown)
-- is retained separately in vendas_diarias_anomalias for operational
-- diagnosis — it is not read here and does not participate in this
-- invariant, by design (two independent computations of the same number
-- would risk silently drifting apart; subtraction cannot).
--
-- Outros is derived, never a stored fake employee/salesperson row: no
-- synthetic funcionarios row, no synthetic vendas_diarias_vendedor row.
--
-- Ticket médio / PA / PM are derived from the summed additive columns for
-- every row (salesperson, Outros, Total) using the same safe-division rule
-- as reconcile-vendas.mjs: null (not 0) when the denominator is zero.
--
-- Store-wide, no role restriction (per the decision that V1 shows
-- current-month team data to all authenticated employees) — the only
-- requirement is get_valid_employee_session_context succeeding, same
-- pattern as get_atendimento_resumo_hoje / get_lista_vez_estado.
-- =============================================================================

create or replace function public.get_vendas_metricas_mtd(
  p_session_token text,
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

  v_fim := (now() at time zone 'America/Manaus')::date;
  v_inicio := date_trunc('month', v_fim)::date;

  return query
    with periodo_vendedor as (
      select v.*
      from public.vendas_diarias_vendedor v
      where v.codigo_filial = p_codigo_filial
        and v.data_venda >= v_inicio
        and v.data_venda <= v_fim
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
        and vdl.data_venda >= v_inicio
        and vdl.data_venda <= v_fim
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

revoke all on function public.get_vendas_metricas_mtd(text, text) from public;
grant execute on function public.get_vendas_metricas_mtd(text, text) to anon;

commit;
