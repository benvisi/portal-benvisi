begin;

-- =============================================================================
-- Consulta de Estoque backend V1 — employee-facing read contract
--
-- Depends on 20260722_001 (get_valid_employee_session_context) and
-- 20260909_001 (estoque_* schema).
--
-- Three anon-facing SECURITY DEFINER read RPCs, matching this project's
-- established pattern exactly: the session is resolved server-side via
-- get_valid_employee_session_context; cargo / identity are never trusted from
-- the client. All three read ONLY from the latest successful sync — an
-- in-progress or failed execution is invisible here by construction.
--
-- cor_descricao_linx is NEVER returned by any of these RPCs. When a snapshot
-- color has no dictionary entry, cor_nome_portal / cor_familia come back null
-- and the cor_codigo is preserved — the Linx source description is never
-- substituted in as a fallback label.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helper: id + concluido_em of the latest successful sync. STABLE,
-- not anon-granted — called only from within the SECURITY DEFINER RPCs below
-- (same idiom as loja_horario_do_dia / hash_session_token).
-- -----------------------------------------------------------------------------
create or replace function public.estoque_sync_atual()
returns table (sync_id uuid, concluido_em timestamptz)
language sql
stable
set search_path = public
as $$
  select e.id, e.concluido_em
  from public.estoque_sync_execucoes e
  where e.status = 'sucesso' and e.concluido_em is not null
  order by e.concluido_em desc
  limit 1;
$$;

revoke all on function public.estoque_sync_atual() from public;

-- -----------------------------------------------------------------------------
-- get_estoque_freshness: when the visible snapshot was completed. Powers the
-- future "Estoque atualizado em DD/MM/YYYY às HH:mm" indicator. Returns no
-- row when no successful sync exists yet.
-- -----------------------------------------------------------------------------
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

  return query select a.concluido_em from public.estoque_sync_atual() a;
end;
$$;

revoke all on function public.get_estoque_freshness(text) from public;
grant execute on function public.get_estoque_freshness(text) to anon;

-- -----------------------------------------------------------------------------
-- buscar_produtos_estoque: primary lookup is case-insensitive PREFIX matching
-- on produto (e.g. 'PH4' -> PH4012, PH4014, PH4050; never PH5522). Linx
-- produto codes are upper-case, so the term is upper-cased and matched with
-- case-sensitive LIKE 'TERM%', which the (sync_id, produto) btree serves.
--
-- Partial product-description matching is offered as a SECONDARY path
-- (desc_produto ILIKE '%term%'); prefix hits always sort first. No fuzzy /
-- trigram infrastructure is introduced. One row per produto; the grade-level
-- detail comes from get_produto_estoque_detalhe.
--
-- Terms shorter than 2 characters return no rows.
-- -----------------------------------------------------------------------------
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
  from public.estoque_snapshot s
  join public.estoque_sync_atual() a on a.sync_id = s.sync_id
  where s.produto like v_prefix
     or s.desc_produto ilike v_contains
  group by s.produto
  order by (s.produto like v_prefix) desc, s.produto
  limit 50;
end;
$$;

revoke all on function public.buscar_produtos_estoque(text, text) from public;
grant execute on function public.buscar_produtos_estoque(text, text) to anon;

-- -----------------------------------------------------------------------------
-- get_produto_estoque_detalhe: for an exact produto, every current color and
-- its complete valid size grade from the latest successful snapshot. Size
-- grain is whatever the snapshot holds (dynamic), ordered by tamanho_key.
-- Zero-quantity sizes are returned (the frontend renders them blank).
--
-- Employee-facing color identity is (cor_codigo, cor_nome_portal); the
-- dictionary is joined on the full (cor_codigo, cor_descricao_linx) key.
-- cor_descricao_linx itself is not in the result.
-- -----------------------------------------------------------------------------
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
    a.concluido_em as sync_concluido_em
  from public.estoque_snapshot s
  join public.estoque_sync_atual() a on a.sync_id = s.sync_id
  left join public.estoque_cores_mapeamento m
    on m.cor_codigo = s.cor_codigo
   and m.cor_descricao_linx = s.cor_descricao_linx
  where s.produto = v_produto
  order by s.cor_codigo, s.tamanho_key;
end;
$$;

revoke all on function public.get_produto_estoque_detalhe(text, text) from public;
grant execute on function public.get_produto_estoque_detalhe(text, text) to anon;

commit;
