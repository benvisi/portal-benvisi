begin;

-- =============================================================================
-- Fix: get_escala_publicacoes_historico was marked STABLE. Verified while
-- manually testing this RPC that a STABLE set-returning function called via
-- `select * from fn(arg)`, where `arg` is a same-statement scalar subquery
-- built from a volatile function (minting a session via verify_pin in a CTE,
-- then immediately passing that token), intermittently fails its own
-- session lookup with INVALID_SESSION even though the session row was just
-- inserted — reproduced consistently, and confirmed fixed by dropping
-- STABLE. This never affected real Portal usage (the client always passes
-- an already-issued session token as a plain literal, never a same-statement
-- volatile subquery), but a session-validating function's correctness
-- should not depend on the caller's query shape, so it is fixed here rather
-- than left as a latent trap for a future admin/debugging query. No other
-- Escala read RPC composes a volatile session-minting subquery this way, so
-- this fix is scoped to this one function only.
-- =============================================================================

create or replace function public.get_escala_publicacoes_historico(p_session_token text)
returns table (
  id uuid,
  mes_referencia date,
  publicado_em timestamptz,
  publicado_por_nome text,
  nome_arquivo text,
  ativa boolean,
  total_registros bigint,
  versao bigint
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

  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESCALA';
  end if;

  return query
  select
    ep.id,
    ep.mes_referencia,
    ep.publicado_em,
    f.nome,
    ep.nome_arquivo,
    ep.ativa,
    (select count(*) from public.escala_entradas e where e.id_publicacao = ep.id),
    row_number() over (partition by ep.mes_referencia order by ep.publicado_em)
  from public.escala_publicacoes ep
  join public.funcionarios f on f.id = ep.publicado_por
  order by ep.mes_referencia desc, ep.publicado_em desc;
end;
$$;

revoke all on function public.get_escala_publicacoes_historico(text) from public;
grant execute on function public.get_escala_publicacoes_historico(text) to anon;

commit;
