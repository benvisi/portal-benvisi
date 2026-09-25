begin;

-- =============================================================================
-- Footwear UK/BR size conversion — expose `grade` on get_produto_estoque_detalhe
--
-- `estoque_atual.grade` already exists (added in 20260911_001) and is
-- populated by the sync (20260911_002/20260914_002's estoque_aplicar_sync
-- insert), but was never returned to the frontend — it was sync-internal
-- metadata only. Discovery established that grade deterministically
-- identifies footwear AND its Masculino/Feminino/Infantil segmento (F1/F2/
-- F62, zero ambiguity/leakage across current inventory), so the Portal can
-- classify footwear from structured data instead of guessing from
-- linha/desc_produto text.
--
-- Return type changes (new `grade` column) so this must be DROP + CREATE,
-- not CREATE OR REPLACE. Every other column, join, filter and the ordering
-- are byte-for-byte identical to the live 20260914_002 definition (verified
-- against the live function definition before this migration was written —
-- no drift found). SECURITY DEFINER, STABLE, search_path and the anon
-- EXECUTE grant are all preserved unchanged.
-- =============================================================================

drop function if exists public.get_produto_estoque_detalhe(text, text);

create function public.get_produto_estoque_detalhe(
  p_session_token text,
  p_produto text
)
returns table (
  produto text,
  desc_produto text,
  tipo_produto text,
  linha text,
  grade text,
  cor_codigo text,
  cor_nome_portal text,
  cor_familia text,
  tamanho_key integer,
  tamanho_venda text,
  quantidade_estoque integer,
  preco numeric(10, 2),
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
    s.grade,
    s.cor_codigo,
    m.cor_nome_portal,
    m.cor_familia,
    s.tamanho_key,
    s.tamanho_venda,
    s.quantidade_estoque,
    pr.preco,
    f.concluido_em as sync_concluido_em
  from public.estoque_atual s
  cross join public.estoque_freshness_atual() f
  left join public.estoque_cores_mapeamento m
    on m.cor_codigo = s.cor_codigo
   and m.cor_descricao_linx = s.cor_descricao_linx
  left join public.estoque_precos_atual pr
    on pr.produto = s.produto
   and pr.cor_codigo = s.cor_codigo
  where s.produto = v_produto
    and s.tamanho_venda is not null
  order by s.cor_codigo, s.tamanho_key;
end;
$$;

revoke all on function public.get_produto_estoque_detalhe(text, text) from public;
grant execute on function public.get_produto_estoque_detalhe(text, text) to anon;

commit;
