begin;

-- =============================================================================
-- Estoque — Organização Semanal — block retroactive generation for weeks
-- that have already ended (correction to Slice 1, commit 82506a5).
--
-- Slice 1 deliberately did not filter by "today" (unlike Limpeza, which only
-- ever syncs today-or-future calendar dates) — the reasoning at the time was
-- that organização semanal is a historical record, not a same-day
-- operational task, so a retroactive Escala correction should still be able
-- to fill in a past week. On review, that is wrong for THIS feature: rule 9
-- ("no rollover... preserve the prior week's final state historically,
-- including partial/non-completion") only makes sense if a week's
-- assignment set is considered final once the week ends — creating brand
-- new assignments for an already-closed week after the fact would silently
-- alter that week's historical record and its future
-- weeks-assigned/weeks-completed reporting, without ever having been visible
-- to the employee during the week the assignment claims to belong to.
--
-- Fix: estoque_organizacao_sincronizar_semana now refuses to CREATE new rows
-- for a week whose Saturday has already passed (Manaus time), determined
-- from the database's own clock via the existing
-- estoque_organizacao_semana_inicio helper — never from client input. This
-- is the single function every entry point funnels through
-- (estoque_organizacao_sincronizar_datas_afetadas, called from the Escala
-- publish hook, and estoque_organizacao_sincronizar_manual, the
-- Gerente/Administrador fallback retry both call
-- estoque_organizacao_sincronizar_semana_com_registro, which calls this),
-- so one guard here covers both the automatic and manual paths with no
-- other function needing to change.
--
-- The guard is a plain early return, not an exception: an ended week is not
-- an error condition (a normal incremental sync batch may legitimately
-- include one, e.g. a revision to last month that also happens to touch a
-- week that closed since), it is simply a no-op. Nothing about existing
-- rows, progress or completion state for that week is touched either way —
-- this function never updates or deletes existing assignment rows, only
-- ever inserts new ones, so history is unaffected regardless of this guard;
-- the guard only stops NEW rows from being backfilled after the fact.
-- Current and future weeks are unaffected: the comparison is
-- semana_inicio >= this week's own Sunday (from the DB's current date), so
-- the current week (still in progress) and every future week continue to
-- generate exactly as before, including a current week whose eligibility is
-- still only partially known because it straddles two monthly Escala
-- publications.
-- =============================================================================

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
begin
  if extract(dow from p_semana_inicio) <> 0 then
    raise exception using errcode = 'P0001', message = 'SEMANA_INICIO_DEVE_SER_DOMINGO';
  end if;

  -- A week whose Saturday has already passed is closed history: never
  -- create new assignments for it, regardless of which entry point called
  -- us. Determined from the database's own current date (Manaus), never
  -- from client input.
  v_semana_atual := public.estoque_organizacao_semana_inicio((now() at time zone 'America/Manaus')::date);
  if p_semana_inicio < v_semana_atual then
    return;
  end if;

  -- Lock the singleton rotation state row first — see 20260927_102's header
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
