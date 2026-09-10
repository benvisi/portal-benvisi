begin;

-- =============================================================================
-- Consulta de Estoque backend V1 — restrict product detail to the labelled grade
--
-- Depends on 20260909_003.
--
-- The canonical Linx extraction stores the full 48-slot ES rectangle per
-- qualifying (produto, cor_codigo) — that is the locked baseline grain
-- (1 371 produto_cores x 48 = 65 808 rows). Roughly three quarters of those
-- slots lie beyond the product's real size grade: they carry
-- quantidade_estoque = 0 and a NULL tamanho_venda (no PRODUTOS_TAMANHOS label
-- for that GRADE position). Every slot that actually holds stock has a label.
--
-- get_produto_estoque_detalhe is the employee-facing grade view, so it now
-- returns only the labelled positions (s.tamanho_venda IS NOT NULL) — the
-- real dynamic grade, still including its zero-stock sizes (rendered blank by
-- the UI). The snapshot table and buscar_produtos_estoque are unchanged:
-- storage stays faithful to the 65 808 baseline, and the search aggregates
-- (sum of quantities, distinct colour count) are unaffected by zero-quantity
-- padding rows.
--
-- CREATE OR REPLACE with an identical signature/return type — safe.
-- =============================================================================

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
    and s.tamanho_venda is not null
  order by s.cor_codigo, s.tamanho_key;
end;
$$;

revoke all on function public.get_produto_estoque_detalhe(text, text) from public;
grant execute on function public.get_produto_estoque_detalhe(text, text) to anon;

commit;
