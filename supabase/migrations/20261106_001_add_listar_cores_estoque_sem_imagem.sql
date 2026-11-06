-- Product image batch: stock-prioritized selection (Trello #10 follow-up).
--
-- The batch worker (scripts/sync-produto-imagens, `npm run lote`) needs to know
-- which produto/colour combinations have stock and no image work yet. The
-- stock table (estoque_atual) has no direct grants for any role, so this
-- service_role-only, read-only function is the only way for the worker to see
-- it. It writes nothing.
--
-- Rules
--   * Stock = sum of quantidade_estoque over all sizes of the produto/colour in
--     estoque_atual (the current-state table; one row per produto, colour and
--     size). Only colours with a total > 0 are returned.
--   * Excluded: any colour that already has a candidate in ANY status (awaiting
--     review, approved, or rejected - a rejected colour is not re-acquired
--     automatically) and any colour with a pending or active publication.
--   * Highest stock first; ties by produto, colour.
--   * `sync_concluido_em` is the completion time of the latest successful stock
--     sync, repeated on every row, so the caller can refuse a stale snapshot.
--
-- Rollback: drop function public.listar_cores_estoque_sem_imagem(integer);

begin;

create or replace function public.listar_cores_estoque_sem_imagem(p_limite integer default 25)
returns table (
  produto text,
  cor_codigo text,
  estoque_total bigint,
  sync_concluido_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sync timestamptz;
begin
  if p_limite is null or p_limite < 1 or p_limite > 200 then
    raise exception using errcode = 'P0001', message = 'LIMITE_INVALIDO';
  end if;

  select f.concluido_em into v_sync from public.estoque_freshness_atual() f;
  if v_sync is null then
    raise exception using errcode = 'P0001', message = 'SEM_SYNC_ESTOQUE';
  end if;

  return query
  select e.produto, e.cor_codigo, pg_catalog.sum(e.quantidade_estoque)::bigint, v_sync
    from public.estoque_atual e
   where not exists (select 1 from public.produto_imagem_candidatos c
                      where c.produto = e.produto and c.cor_codigo = e.cor_codigo)
     and not exists (select 1 from public.produto_imagem_publicacoes p
                      where p.produto = e.produto and p.cor_codigo = e.cor_codigo
                        and p.status in ('pendente', 'ativa'))
   group by e.produto, e.cor_codigo
  having pg_catalog.sum(e.quantidade_estoque) > 0
   order by 3 desc, e.produto, e.cor_codigo
   limit p_limite;
end;
$$;

revoke all on function public.listar_cores_estoque_sem_imagem(integer) from public, anon, authenticated;
grant execute on function public.listar_cores_estoque_sem_imagem(integer) to service_role;

commit;
