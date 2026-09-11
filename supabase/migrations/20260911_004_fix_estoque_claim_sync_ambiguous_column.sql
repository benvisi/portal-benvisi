begin;

-- =============================================================================
-- Consulta de Estoque — Sync V2 — fix estoque_claim_sync ambiguous column
--
-- Depends on 20260911_002. Found during backend QA (stale-execution-recovery
-- test): estoque_claim_sync's RETURNS TABLE declares an output column named
-- sync_id, which PL/pgSQL exposes as an implicit variable throughout the
-- function body. That collided with the sync_id COLUMN on
-- estoque_staging_grupos/estoque_staging_linhas inside the stale-recovery
-- cleanup DELETEs, which referenced sync_id unqualified — Postgres correctly
-- raised "column reference sync_id is ambiguous" (42702) rather than guessing.
--
-- Fix: qualify both DELETEs with an explicit table alias. No signature change
-- (identical to 20260911_002's version) — CREATE OR REPLACE is safe, same
-- idiom used throughout this project (e.g. 20260909_004).
-- =============================================================================

create or replace function public.estoque_claim_sync()
returns table (
  sync_id uuid,
  claimed boolean,
  motivo text,
  execucao_anterior_recuperada uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stale record;
  v_recovered uuid := null;
  v_new_id uuid;
begin
  select e.id, e.iniciado_em into v_stale
  from public.estoque_sync_execucoes e
  where e.status = 'executando'
  order by e.iniciado_em desc
  limit 1
  for update;

  if found then
    if v_stale.iniciado_em > now() - interval '30 minutes' then
      return query select null::uuid, false, 'BUSY'::text, null::uuid;
      return;
    end if;

    update public.estoque_sync_execucoes
    set status = 'erro',
        concluido_em = now(),
        error_code = 'ABANDONED_STALE_TIMEOUT',
        erro = 'No apply/failure signal received within 30 minutes of claim; assumed crashed and superseded by a newer run.'
    where id = v_stale.id;

    delete from public.estoque_staging_linhas l where l.sync_id = v_stale.id;
    delete from public.estoque_staging_grupos g where g.sync_id = v_stale.id;

    v_recovered := v_stale.id;
  end if;

  begin
    insert into public.estoque_sync_execucoes (status)
    values ('executando')
    returning id into v_new_id;
  exception when unique_violation then
    return query select null::uuid, false, 'BUSY'::text, v_recovered;
    return;
  end;

  return query select v_new_id, true, 'CLAIMED'::text, v_recovered;
end;
$$;

revoke all on function public.estoque_claim_sync() from public;
grant execute on function public.estoque_claim_sync() to service_role;

commit;
