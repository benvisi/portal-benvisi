begin;

-- =============================================================================
-- Estoque — Organização Semanal (V1, Slice 1) — generation/synchronization.
--
-- ELIGIBILITY (product rule, applied literally — no extra exclusion beyond
-- Administrador is invented here, unlike Limpeza's cargo-exclusion table):
-- a funcionario is eligible for a given Sunday-Saturday week iff is_active,
-- cargo <> 'Administrador', and at least one escala_entradas row with
-- status = 'trabalho' inside that week, from whichever escala_publicacoes
-- are currently ativa (a week's own two halves may come from two different
-- monthly publications when it straddles a month boundary — this query
-- makes no assumption about which publication a day's row came from, so
-- that split is transparent to it).
--
-- ROTATION ORDERING / CONCURRENCY (the edge case explicitly called out
-- before implementation): the counter in estoque_organizacao_rotacao_estado
-- is a pure FIFO sequence over the order estante numbers are actually handed
-- out — never reset per week, never reassigned. This is deliberately NOT
-- reordered into calendar week order, because doing so would require
-- renumbering already-created rows whenever an out-of-order or late
-- publication revealed an earlier week — and existing assignments must
-- NEVER be reshuffled. Concretely:
--   - estoque_organizacao_sincronizar_semana(p_semana_inicio) locks the
--     singleton rotation-state row `for update` FIRST, before reading
--     eligibility or existing assignments for that week. Two concurrent
--     calls (same week or different weeks) simply serialize on that one
--     row lock — there is no way for two calls to read the same
--     proximo_numero and both act on it.
--   - Within one locked call, only funcionarios NOT already present in
--     estoque_organizacao_atribuicoes for that week are considered (the
--     unique(semana_inicio, funcionario_id) constraint is the second,
--     storage-level backstop against a duplicate). New assignees are
--     iterated in a fixed deterministic order (apelido, id) and handed
--     consecutive numbers, wrapping 41->1, with the counter persisted
--     back to the state row before the function returns (so a crash
--     mid-loop cannot re-hand-out a number already committed to an
--     earlier row in the same call, since inserts and the counter update
--     happen inside the same transaction as the lock).
--   - Retrying the exact same publish (a revision that produced no new
--     eligibility, or a duplicate/at-least-once delivery of the same
--     Escala publish call) is a no-op: every already-eligible funcionario
--     for that week already has a row, so the "still needs a number" set
--     is empty and proximo_numero does not move.
--   - Out-of-order calls (e.g. a later month's Escala gets published,
--     and later still an earlier month's revision arrives) are handled the
--     same way as any other call: whichever funcionarios are newly
--     eligible for whichever week, at the time the call runs, receive the
--     next available numbers in the global sequence at that time. The
--     counter reflects generation order, not calendar order, by design.
--
-- Unlike Limpeza (which only ever syncs today-or-future calendar dates,
-- because a cleaning assignment for a day that already happened is
-- meaningless), this feature intentionally has NO such floor: an Escala
-- revision that retroactively fills in a past week must still be able to
-- generate that week's assignment, since organização semanal is a
-- historical record, not a same-day operational task. Nothing here filters
-- by "today".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- estoque_organizacao_semana_inicio — the Sunday that starts the
-- Sunday-Saturday week containing p_data. Postgres extract(dow, ...) returns
-- 0 for Sunday, so this is simply p_data minus that offset.
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_semana_inicio(p_data date)
returns date
language sql
set search_path = public
immutable
as $$
  select p_data - extract(dow from p_data)::int;
$$;

revoke all on function public.estoque_organizacao_semana_inicio(date) from public;

-- ---------------------------------------------------------------------------
-- estoque_organizacao_sincronizar_semana — reconcile one week: assign the
-- next available estante(s) to whichever eligible funcionarios do not yet
-- have a row for this semana_inicio. Never touches an existing row. Internal
-- only; always called through estoque_organizacao_sincronizar_semana_com_registro.
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_sincronizar_semana(p_semana_inicio date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proximo smallint;
  v_funcionario record;
begin
  if extract(dow from p_semana_inicio) <> 0 then
    raise exception using errcode = 'P0001', message = 'SEMANA_INICIO_DEVE_SER_DOMINGO';
  end if;

  -- Lock the singleton rotation state row first — see header comment for why
  -- this single lock is what makes the whole function safe under
  -- concurrency, independent of week or call ordering.
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

-- ---------------------------------------------------------------------------
-- estoque_organizacao_sincronizar_semana_com_registro — the ONE place that
-- calls estoque_organizacao_sincronizar_semana, mirroring
-- limpeza_sincronizar_dia_com_registro (20260925_104). On success, resolves
-- any previously unresolved failure for that week. On failure, records one
-- and never raises — so a bug here can never propagate up into the Escala
-- publish transaction that triggered it.
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_sincronizar_semana_com_registro(p_semana_inicio date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.estoque_organizacao_sincronizar_semana(p_semana_inicio);

    update public.estoque_organizacao_sync_falhas
    set resolvido_em = now()
    where semana_inicio = p_semana_inicio and resolvido_em is null;
  exception when others then
    insert into public.estoque_organizacao_sync_falhas (semana_inicio, motivo)
    values (p_semana_inicio, sqlerrm);
  end;
end;
$$;

revoke all on function public.estoque_organizacao_sincronizar_semana_com_registro(date) from public;

-- ---------------------------------------------------------------------------
-- estoque_organizacao_sincronizar_datas_afetadas — takes the same
-- "affected dates" array escala_processar_importacao already computes for
-- the Limpeza hook (whole month on first publish, diffed dates on a
-- revision), maps each date to its Sunday week-start, dedupes, and
-- reconciles each affected week exactly once, in ascending order (a
-- deterministic default for a single batch — see header comment on why
-- cross-call ordering does not need to be, and cannot be, calendar order).
-- Never raises: every week goes through the registering wrapper above.
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_sincronizar_datas_afetadas(p_datas date[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_semana date;
begin
  for v_semana in
    select distinct public.estoque_organizacao_semana_inicio(d)
    from unnest(coalesce(p_datas, array[]::date[])) as d
    order by 1
  loop
    perform public.estoque_organizacao_sincronizar_semana_com_registro(v_semana);
  end loop;
end;
$$;

revoke all on function public.estoque_organizacao_sincronizar_datas_afetadas(date[]) from public;

-- ---------------------------------------------------------------------------
-- estoque_organizacao_sincronizar_manual — Gerente/Administrador fallback
-- resync, mirroring limpeza_sincronizar_manual: recovers from a publish-time
-- sync that failed silently, or any other drift. Takes a month and
-- resyncs every week whose 7-day span overlaps it (a week is identified by
-- its Sunday, so this includes the week straddling the start of the month
-- and the week straddling its end).
-- ---------------------------------------------------------------------------
create or replace function public.estoque_organizacao_sincronizar_manual(p_session_token text, p_mes date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_mes_inicio date;
  v_mes_fim date;
  v_semana date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;

  v_mes_inicio := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_inicio + interval '1 month' - interval '1 day')::date;

  v_semana := public.estoque_organizacao_semana_inicio(v_mes_inicio);
  while v_semana <= v_mes_fim loop
    perform public.estoque_organizacao_sincronizar_semana_com_registro(v_semana);
    v_semana := v_semana + 7;
  end loop;
end;
$$;

revoke all on function public.estoque_organizacao_sincronizar_manual(text, date) from public;
grant execute on function public.estoque_organizacao_sincronizar_manual(text, date) to anon;

-- ---------------------------------------------------------------------------
-- get_estoque_organizacao_sync_pendencias — Gerente/Administrador only:
-- every week whose most recent sync attempt is still unresolved. Mirrors
-- get_limpeza_sync_pendencias exactly.
-- ---------------------------------------------------------------------------
create or replace function public.get_estoque_organizacao_sync_pendencias(p_session_token text)
returns table (
  semana_inicio date,
  falhou_em timestamptz,
  motivo text
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
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_ESTOQUE_ORGANIZACAO';
  end if;

  return query
  select f.semana_inicio, f.falhou_em, f.motivo
  from public.estoque_organizacao_sync_falhas f
  where f.resolvido_em is null
  order by f.semana_inicio;
end;
$$;

revoke all on function public.get_estoque_organizacao_sync_pendencias(text) from public;
grant execute on function public.get_estoque_organizacao_sync_pendencias(text) to anon;

commit;
