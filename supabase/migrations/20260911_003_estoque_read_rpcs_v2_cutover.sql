begin;

-- =============================================================================
-- Consulta de Estoque — Sync V2 — Phase B read cutover
--
-- Depends on 20260911_002 (estoque_freshness_atual) and a completed, parity-
-- verified bootstrap of estoque_atual from the latest V1 estoque_snapshot
-- (V2 brief section 22-23, Phase A). Only applied after that parity check
-- passes — this is the "Phase B" migration described in the V2 rollout plan.
--
-- CREATE OR REPLACE with IDENTICAL signatures/return types to the V1
-- versions in 20260909_003 / 20260909_004 (safe, same idiom used there) —
-- the Consulta UI requires zero changes. Only the FROM clause changes: from
-- estoque_snapshot joined to estoque_sync_atual() (sync_id-scoped) to
-- estoque_atual directly (no sync_id dimension — it always holds exactly the
-- current state, by construction of estoque_aplicar_sync).
--
-- estoque_snapshot, estoque_sync_atual(), and all V1 data are left
-- completely untouched — rollback is a further CREATE OR REPLACE back to the
-- 20260909_004 bodies, with zero data loss.
-- =============================================================================

create or replace function public.get_estoque_freshness(p_session_token text)
returns table (sync_concluido_em timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  return query select f.concluido_em from public.estoque_freshness_atual() f;
end;
$$;

revoke all on function public.get_estoque_freshness(text) from public;
grant execute on function public.get_estoque_freshness(text) to anon;

create or replace function public.buscar_produtos_estoque(
  p_session_token text,
  p_termo text
)
returns table (
  produto text,
  desc_produto text,
  tipo_produto text,
  linha text,
  cores_disponiveis integer,
  unidades_total bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_termo text;
  v_prefix text;
  v_contains text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_termo := trim(coalesce(p_termo, ''));
  if length(v_termo) < 2 then
    return;
  end if;

  v_prefix := upper(v_termo) || '%';
  v_contains := '%' || v_termo || '%';

  return query
  select
    s.produto,
    min(s.desc_produto) as desc_produto,
    min(s.tipo_produto) as tipo_produto,
    min(s.linha) as linha,
    count(distinct s.cor_codigo)::integer as cores_disponiveis,
    sum(s.quantidade_estoque)::bigint as unidades_total
  from public.estoque_atual s
  where s.produto like v_prefix
     or s.desc_produto ilike v_contains
  group by s.produto
  order by (s.produto like v_prefix) desc, s.produto
  limit 50;
end;
$$;

revoke all on function public.buscar_produtos_estoque(text, text) from public;
grant execute on function public.buscar_produtos_estoque(text, text) to anon;

create or replace function public.get_produto_estoque_detalhe(
  p_session_token text,
  p_produto text
)
returns table (
  produto text,
  desc_produto text,
  tipo_produto text,
  linha text,
  cor_codigo text,
  cor_nome_portal text,
  cor_familia text,
  tamanho_key integer,
  tamanho_venda text,
  quantidade_estoque integer,
  sync_concluido_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_produto text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_produto := upper(trim(coalesce(p_produto, '')));
  if length(v_produto) = 0 then
    return;
  end if;

  return query
  select
    s.produto,
    s.desc_produto,
    s.tipo_produto,
    s.linha,
    s.cor_codigo,
    m.cor_nome_portal,
    m.cor_familia,
    s.tamanho_key,
    s.tamanho_venda,
    s.quantidade_estoque,
    f.concluido_em as sync_concluido_em
  from public.estoque_atual s
  cross join public.estoque_freshness_atual() f
  left join public.estoque_cores_mapeamento m
    on m.cor_codigo = s.cor_codigo
   and m.cor_descricao_linx = s.cor_descricao_linx
  where s.produto = v_produto
    and s.tamanho_venda is not null
  order by s.cor_codigo, s.tamanho_key;
end;
$$;

revoke all on function public.get_produto_estoque_detalhe(text, text) from public;
grant execute on function public.get_produto_estoque_detalhe(text, text) to anon;

commit;
