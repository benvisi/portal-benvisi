begin;

-- =============================================================================
-- Estoque — Organização Semanal — controlled activation floor.
--
-- Without this, the very next Escala publish/revision after this feature
-- deploys would immediately generate assignments for the CURRENT week (the
-- past-week guard added in 20260927_104 only blocks weeks that have already
-- ended — the current week is, by definition, always allowed). That is
-- surprising for a first rollout: employees would receive a mid-week
-- assignment for a week that is already partly over, with no advance
-- notice, mid-week guidance rollout.
--
-- Fix: add a one-time "ativo_a_partir" floor to the same singleton rotation
-- state row already used for the estante counter, defaulting — at the exact
-- moment this migration is applied (deployment time) — to the Sunday of the
-- week AFTER the current one. estoque_organizacao_sincronizar_semana now
-- refuses to generate for any week before whichever is later: the current
-- week, or this floor. Once real calendar time reaches the floor week, this
-- has no further effect — current/future-week generation proceeds exactly
-- as it did before this migration, and no separate toggle or cleanup step
-- is needed.
--
-- This value is intentionally not exposed through any RPC: it is a one-time
-- deployment safety valve, not an ongoing configuration a manager should be
-- adjusting. If it ever genuinely needs to change, that is a direct SQL
-- update against this one row, same as feriados.
-- =============================================================================

alter table public.estoque_organizacao_rotacao_estado
  add column ativo_a_partir date;

update public.estoque_organizacao_rotacao_estado
set ativo_a_partir = public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date) + 7
where id = 1;

alter table public.estoque_organizacao_rotacao_estado
  alter column ativo_a_partir set not null;

alter table public.estoque_organizacao_rotacao_estado
  add constraint estoque_organizacao_rotacao_estado_ativo_a_partir_domingo
  check (extract(dow from ativo_a_partir) = 0);

create or replace function public.estoque_organizacao_sincronizar_semana(p_semana_inicio date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proximo smallint;
  v_funcionario record;
  v_semana_atual date;
  v_ativo_a_partir date;
  v_minimo date;
begin
  if extract(dow from p_semana_inicio) <> 0 then
    raise exception using errcode = 'P0001', message = 'SEMANA_INICIO_DEVE_SER_DOMINGO';
  end if;

  -- Cheap, lock-free check first: a week before the later of (current week,
  -- activation floor) is never touched, so most no-op calls never need to
  -- acquire the rotation lock at all.
  select ativo_a_partir into v_ativo_a_partir
  from public.estoque_organizacao_rotacao_estado
  where id = 1;

  v_semana_atual := public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date);
  v_minimo := greatest(v_semana_atual, v_ativo_a_partir);
  if p_semana_inicio < v_minimo then
    return;
  end if;

  -- Lock the singleton rotation state row — see 20260927_102's header
  -- comment for why this single lock is what makes the whole function safe
  -- under concurrency, independent of week or call ordering.
  select proximo_numero into v_proximo
  from public.estoque_organizacao_rotacao_estado
  where id = 1
  for update;

  for v_funcionario in
    select f.id
    from public.funcionarios f
    where f.is_active = true
      and f.cargo <> 'Administrador'
      and exists (
        select 1
        from public.escala_entradas e
        join public.escala_publicacoes ep on ep.id = e.id_publicacao and ep.ativa = true
        where e.id_funcionario = f.id
          and e.status = 'trabalho'
          and e.data between p_semana_inicio and (p_semana_inicio + 6)
      )
      and not exists (
        select 1
        from public.estoque_organizacao_atribuicoes a
        where a.semana_inicio = p_semana_inicio and a.funcionario_id = f.id
      )
    order by f.apelido, f.id
  loop
    insert into public.estoque_organizacao_atribuicoes
      (semana_inicio, funcionario_id, numero_estante, origem)
    values
      (p_semana_inicio, v_funcionario.id, v_proximo, 'automatica');

    v_proximo := case when v_proximo = 41 then 1 else v_proximo + 1 end;
  end loop;

  update public.estoque_organizacao_rotacao_estado
  set proximo_numero = v_proximo, atualizado_em = now()
  where id = 1;
end;
$$;

revoke all on function public.estoque_organizacao_sincronizar_semana(date) from public;

commit;
