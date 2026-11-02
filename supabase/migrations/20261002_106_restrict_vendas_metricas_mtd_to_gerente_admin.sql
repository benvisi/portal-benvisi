begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — restrict get_vendas_metricas_mtd to
-- Gerente + Administrador.
--
-- Forward migration on top of 20261002_105 (already deployed — never edited
-- in place). Product decision: Relatório de vendas is a Gerente/Administrador
-- report for V1 (interim policy; a future Shared Device Mode may let
-- ordinary employees see it from an authorized in-store terminal — NOT
-- implemented here, deliberately no device-aware logic).
--
-- The ONLY change versus 105 is the cargo check right after session
-- validation: a valid session whose cargo is not 'Gerente' or
-- 'Administrador' now raises P0001 / SEM_PERMISSAO_VENDAS_RELATORIO (same
-- pattern as get_estoque_organizacao_gerencial_semana). The cargo is read
-- from get_valid_employee_session_context (server-side database row), never
-- supplied by the client. Everything else — Manaus month-to-date window,
-- Total (store-level) / Outros (Total minus mapped sellers) semantics,
-- ratios, ordering, SECURITY DEFINER, search_path, the p_codigo_filial
-- default and the grants — is byte-for-byte the 105 function.
--
-- CREATE OR REPLACE keeps the existing owner and ACL; the revoke/grant below
-- re-state the intended grants (anon only, as in 105: the browser uses the
-- anon key and the employee session token is the real credential).
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
  -- V1 interim policy: Relatório de vendas is Gerente/Administrador only.
  -- The cargo comes from the validated server-side session context (the
  -- database row), never from anything the browser sends.
  if v_ctx.cargo is null or v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_VENDAS_RELATORIO';
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
