begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A — authenticated MTD read RPC.
--
-- public.get_vendas_metricas_mtd(p_session_token, p_codigo_filial) returns
-- one row per salesperson who has at least one vendas_diarias_vendedor row
-- this calendar month, PLUS one store-total row (eh_total = true), for the
-- future UI table: Vendedor | R$ | Ticket médio | PA | PM | Tickets | Peças
-- | Trocas | Peças líquidas. Every row also repeats atualizado_em (the most
-- recent sync timestamp among the included rows) as the freshness signal —
-- same flat/repeated-header idiom as get_atendimento_resumo_hoje.
--
-- MTD = SUM() over this table's additive daily rows for the current Manaus
-- calendar month to date — never stored separately (data grain decision for
-- this slice). Ticket médio / PA / PM are derived here, from the SUMMED
-- additive columns (not averaged per-day), using the same safe-division
-- rule as scripts/sales-metrics-reconciliation/reconcile-vendas.mjs: null
-- (not 0) when the denominator is zero.
--
-- Store total = SUM() across every salesperson row returned here (i.e. only
-- clean, attributed data — the same tickets already excluded from this
-- table at sync time for being cancelled/anomalous/unmapped stay excluded
-- from the total too). This does NOT attempt to reconcile to the
-- store-level Power BI total, which includes anomalous tickets by design
-- (see linx-vendas-query.sql's header) — flagged as an open question in
-- this slice's report, not solved here.
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
    with periodo as (
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
        false as eh_total,
        sum(p.venda_liquida)::numeric as venda_liquida,
        sum(p.tickets)::integer as tickets,
        sum(p.pecas_brutas)::integer as pecas_brutas,
        sum(p.pecas_troca)::integer as pecas_troca,
        sum(p.pecas_liquidas)::integer as pecas_liquidas,
        max(p.atualizado_em) as atualizado_em
      from periodo p
      join public.funcionarios f on f.id = p.funcionario_id
      group by p.funcionario_id, f.apelido, f.nome
    ),
    total as (
      select
        null::uuid as funcionario_id,
        'Total da loja'::text as vendedor_nome,
        true as eh_total,
        coalesce(sum(venda_liquida), 0)::numeric as venda_liquida,
        coalesce(sum(tickets), 0)::integer as tickets,
        coalesce(sum(pecas_brutas), 0)::integer as pecas_brutas,
        coalesce(sum(pecas_troca), 0)::integer as pecas_troca,
        coalesce(sum(pecas_liquidas), 0)::integer as pecas_liquidas,
        max(atualizado_em) as atualizado_em
      from por_vendedor
    )
    select
      c.funcionario_id,
      c.vendedor_nome,
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
      select * from total
    ) c
    order by c.eh_total asc, c.venda_liquida desc;
end;
$$;

revoke all on function public.get_vendas_metricas_mtd(text, text) from public;
grant execute on function public.get_vendas_metricas_mtd(text, text) to anon;

commit;
