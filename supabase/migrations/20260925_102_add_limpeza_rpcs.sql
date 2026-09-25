begin;

-- =============================================================================
-- Limpeza V1 — generation, synchronization, completion and read RPCs.
--
-- ELIGIBILITY — two independent questions, never conflated:
--   1. Is this funcionario scheduled to work a shift compatible with this
--      cleaning turno? (limpeza_funcionario_escalado_turno) An employee
--      classified 'manha' or 'tarde' (escala_classificar_turno) is only
--      compatible with that same turno; an employee classified
--      'intermediario' is compatible with BOTH manha and tarde cleaning
--      slots, since their shift spans the boundary between the two and a
--      rigid single-turno assignment would starve them of the rotation
--      entirely (product decision 2026-09-25). This check alone is what a
--      manual override must satisfy — it never looks at cargo.
--   2. Does this funcionario participate in the AUTOMATIC rotation at all?
--      (limpeza_funcionario_regras_automaticas) active, not Gestão, cargo
--      not in limpeza_cargos_excluidos. A manual override is exempt from
--      this — a Gerente/Administrador can deliberately assign an excluded
--      cargo, since that is a human decision, not the algorithm's.
-- A funcionario may hold at most one cleaning assignment per calendar day
-- (any turno, any tarefa) — enforced by excluding, from the automatic
-- candidate pool, everyone who already holds a concluída or bloqueada
-- (manual) row that same day, and by reserving each automatic pick as soon
-- as it is made so later slots in the same day-sync exclude it too. Manual
-- overrides are NOT subject to this same-day exclusivity check — a
-- Gerente/Administrador may deliberately double-book someone if needed.
--
-- FAIRNESS ALGORITHM (limpeza_proximo_candidato): pool = every funcionario
-- eligible per both checks above for this turno, minus everyone already
-- reserved today. Ranked ascending by:
--   1. (implicit — the pool itself already excludes same-day duplicates)
--   2. whether they have ANY limpeza assignment on data - 1;
--   3. how many assignments of THIS SAME tarefa they already have this month;
--   4. how many limpeza assignments of any tarefa they already have this
--      month (total workload);
--   5. apelido, then 6. id — deterministic, auditable tie-break.
-- The four slots of a day (manha/varrer, manha/passar_pano, tarde/varrer,
-- tarde/passar_pano) are resolved in that fixed order so each slot's
-- selection can exclude everyone already finalized earlier in the same run.
--
-- SYNCHRONIZATION — explicit, tied to Escala publication (V1 architecture
-- decision 2026-09-25). Nothing runs on a schedule, and ordinary reads
-- (get_limpeza_dia/mes/gerencial_mes) never mutate. Escala's own publish RPC
-- (escala_processar_importacao, see 20260925_103) calls
-- limpeza_sincronizar_datas_afetadas with exactly the dates that changed on a
-- revision, or the whole newly-published month on a first-time publish, and
-- isolates each date's sync in its own failure boundary so Limpeza can never
-- block or roll back an Escala publication. limpeza_sincronizar_manual is
-- the Gerente/Administrador-facing fallback (Gerenciar tab "Sincronizar")
-- for recovering from a sync that failed silently or any other drift. Dates
-- in the past, and any row already status = 'concluida', are never touched
-- by any of these paths. A manual (bloqueada) assignment is never
-- overwritten: if the manually assigned employee stops being schedule-
-- compatible with that slot, the row flips to status = 'conflito' instead.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- limpeza_funcionario_escalado_turno — schedule-only compatibility check
-- (see header). This is the ENTIRE validity rule for a manual override.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_funcionario_escalado_turno(
  p_funcionario_id uuid,
  p_data date,
  p_turno text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.funcionarios f
    join public.escala_publicacoes ep
      on ep.mes_referencia = date_trunc('month', p_data)::date and ep.ativa = true
    join public.escala_entradas e
      on e.id_publicacao = ep.id and e.id_funcionario = f.id and e.data = p_data
    cross join lateral public.loja_horario_do_dia(p_data) h
    where f.id = p_funcionario_id
      and f.is_active = true
      and e.status = 'trabalho'
      and public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
        in (p_turno, 'intermediario')
  );
$$;

revoke all on function public.limpeza_funcionario_escalado_turno(uuid, date, text) from public;

-- ---------------------------------------------------------------------------
-- limpeza_funcionario_regras_automaticas — automatic-rotation-only rule (see
-- header). Cargo exclusion and Gestão exclusion apply ONLY here, never to a
-- manual override's validity.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_funcionario_regras_automaticas(p_funcionario_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.funcionarios f
    where f.id = p_funcionario_id
      and f.is_active = true
      and f.escala_grupo_gestao = false
      and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
  );
$$;

revoke all on function public.limpeza_funcionario_regras_automaticas(uuid) from public;

-- ---------------------------------------------------------------------------
-- limpeza_proximo_candidato — the fairness ranking documented above.
-- p_reservados: funcionarios already holding a cleaning assignment today
-- (any turno/tarefa) — excluded from the pool entirely, which is how "at
-- most one assignment per day" is enforced for the automatic algorithm.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_proximo_candidato(
  p_data date,
  p_turno text,
  p_tarefa text,
  p_reservados uuid[] default array[]::uuid[]
)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  with elegiveis as (
    select f.id, f.apelido
    from public.funcionarios f
    join public.escala_publicacoes ep
      on ep.mes_referencia = date_trunc('month', p_data)::date and ep.ativa = true
    join public.escala_entradas e
      on e.id_publicacao = ep.id and e.id_funcionario = f.id and e.data = p_data
    cross join lateral public.loja_horario_do_dia(p_data) h
    where f.is_active = true
      and e.status = 'trabalho'
      and f.escala_grupo_gestao = false
      and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
      and public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento)
        in (p_turno, 'intermediario')
      and not (f.id = any(coalesce(p_reservados, array[]::uuid[])))
  ),
  contagens as (
    select
      el.id,
      el.apelido,
      (
        select count(*) from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id
          and a.data >= date_trunc('month', p_data)::date
          and a.data < (date_trunc('month', p_data) + interval '1 month')::date
      ) as total_mes,
      (
        select count(*) from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id
          and a.tarefa = p_tarefa
          and a.data >= date_trunc('month', p_data)::date
          and a.data < (date_trunc('month', p_data) + interval '1 month')::date
      ) as tarefa_mes,
      exists (
        select 1 from public.limpeza_atribuicoes a
        where a.funcionario_id = el.id and a.data = p_data - 1
      ) as atribuido_ontem
    from elegiveis el
  )
  select id
  from contagens
  order by atribuido_ontem asc, tarefa_mes asc, total_mes asc, apelido asc, id asc
  limit 1;
$$;

revoke all on function public.limpeza_proximo_candidato(date, text, text, uuid[]) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_dia — reconcile one date's four slots. Internal; never
-- called from an ordinary read RPC (see header) — only from
-- limpeza_sincronizar_datas_afetadas (Escala publish hook) and
-- limpeza_sincronizar_manual (Gerenciar tab fallback).
--
-- Concurrency: each of the four slots is locked with `for update` in a
-- fixed order (manha/varrer, manha/passar_pano, tarde/varrer,
-- tarde/passar_pano) before being read or written. Two concurrent calls for
-- the SAME date always acquire these row locks in that same fixed order, so
-- the second caller simply blocks behind the first (standard row-lock
-- queueing) with no possibility of a lock-order deadlock between them.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_sincronizar_dia(p_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turno text;
  v_tarefa text;
  v_row record;
  v_found boolean;
  v_reservados uuid[];
  v_candidato uuid;
  v_status text;
begin
  -- Reserve whoever already holds a concluída or bloqueada (manual) slot
  -- today — those rows are never touched below, and nobody may receive a
  -- second automatic assignment the same day.
  select coalesce(array_agg(distinct funcionario_id), array[]::uuid[])
    into v_reservados
  from public.limpeza_atribuicoes
  where data = p_data
    and funcionario_id is not null
    and (status = 'concluida' or bloqueada = true);

  foreach v_turno in array array['manha', 'tarde'] loop
    foreach v_tarefa in array array['varrer', 'passar_pano'] loop
      select * into v_row
      from public.limpeza_atribuicoes
      where data = p_data and turno = v_turno and tarefa = v_tarefa
      for update;
      v_found := found;

      if v_found and v_row.status = 'concluida' then
        continue; -- already reserved above; never touched.
      end if;

      if v_found and v_row.bloqueada then
        if v_row.funcionario_id is not null
           and public.limpeza_funcionario_escalado_turno(v_row.funcionario_id, p_data, v_turno) then
          if v_row.status = 'conflito' then
            update public.limpeza_atribuicoes
              set status = 'pendente', conflito_motivo = null, atualizado_em = now()
              where id = v_row.id;
          end if;
        elsif v_row.status <> 'conflito' then
          update public.limpeza_atribuicoes
            set status = 'conflito',
                conflito_motivo = 'FUNCIONARIO_NAO_ELEGIVEL_APOS_ATUALIZACAO_ESCALA',
                atualizado_em = now()
            where id = v_row.id;
        end if;
        continue; -- already reserved above (bloqueada); never reassigned automatically.
      end if;

      -- Automatic slot, still valid: schedule-compatible with this turno,
      -- still part of the automatic rotation, and not reserved elsewhere
      -- today by a concluída/bloqueada row (or an earlier slot this run).
      if v_found
         and v_row.funcionario_id is not null
         and not (v_row.funcionario_id = any(v_reservados))
         and public.limpeza_funcionario_escalado_turno(v_row.funcionario_id, p_data, v_turno)
         and public.limpeza_funcionario_regras_automaticas(v_row.funcionario_id) then
        v_reservados := v_reservados || v_row.funcionario_id;
        continue;
      end if;

      -- Needs a (re)assignment.
      v_candidato := public.limpeza_proximo_candidato(p_data, v_turno, v_tarefa, v_reservados);

      if v_found then
        v_status := case when v_candidato is null then 'sem_candidato' else 'pendente' end;
        update public.limpeza_atribuicoes
          set funcionario_id = v_candidato,
              status = v_status,
              conflito_motivo = null,
              atualizado_em = now()
          where id = v_row.id;
      elsif v_candidato is not null then
        insert into public.limpeza_atribuicoes (data, turno, tarefa, funcionario_id, origem, status)
        values (p_data, v_turno, v_tarefa, v_candidato, 'automatica', 'pendente');
      end if;
      -- else: no existing row and no eligible candidate — nothing to create.

      if v_candidato is not null then
        v_reservados := v_reservados || v_candidato;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.limpeza_sincronizar_dia(date) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_periodo — sync every date >= today (Manaus) within
-- [p_data_inicio, p_data_fim]. Past dates are never touched. Used by
-- limpeza_sincronizar_manual (whole-month fallback resync).
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_sincronizar_periodo(p_data_inicio date, p_data_fim date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Manaus')::date;
  v_dia date;
begin
  v_dia := greatest(p_data_inicio, v_hoje);
  while v_dia <= p_data_fim loop
    perform public.limpeza_sincronizar_dia(v_dia);
    v_dia := v_dia + 1;
  end loop;
end;
$$;

revoke all on function public.limpeza_sincronizar_periodo(date, date) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_datas_afetadas — sync exactly the given dates (deduped,
-- past/today-before-Manaus filtered). Called from escala_processar_importacao
-- (20260925_103) with only the dates a publish actually changed (revision)
-- or the whole newly-published month (first-time publish, when there is
-- nothing yet to diff against). Each date's sync runs in its own failure
-- boundary (a plpgsql nested block = an implicit savepoint): if one date's
-- reconciliation raises for any reason, that date's partial work rolls back
-- to before it started, but every other date in the batch still runs, and
-- nothing here ever propagates an exception to the caller. This function is
-- never called with anon privileges directly (see 20260925_103's own
-- exception guard around calling it) — a bug here must never be able to
-- block or roll back an Escala publication.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_sincronizar_datas_afetadas(p_datas date[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Manaus')::date;
  v_data date;
begin
  foreach v_data in array coalesce(p_datas, array[]::date[]) loop
    if v_data >= v_hoje then
      begin
        perform public.limpeza_sincronizar_dia(v_data);
      exception when others then
        -- Isolate a single date's failure so the rest of the batch still
        -- syncs; recoverable afterward via limpeza_sincronizar_manual.
        null;
      end;
    end if;
  end loop;
end;
$$;

revoke all on function public.limpeza_sincronizar_datas_afetadas(date[]) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_manual — Gerente/Administrador fallback resync for a
-- whole month (Gerenciar tab "Sincronizar"). Recovery path for a publish-time
-- sync that failed silently, or any other drift between Escala and Limpeza.
-- Ordinary reads never call this or any other sync function themselves.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_sincronizar_manual(p_session_token text, p_mes date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;

  perform public.limpeza_sincronizar_periodo(v_mes_ref, v_mes_fim);
end;
$$;

revoke all on function public.limpeza_sincronizar_manual(text, date) from public;
grant execute on function public.limpeza_sincronizar_manual(text, date) to anon;

-- ---------------------------------------------------------------------------
-- get_limpeza_dia — one day's four slots, team-visible (transparency: any
-- authenticated employee sees the whole day). Pure read — does not sync.
-- ---------------------------------------------------------------------------
create or replace function public.get_limpeza_dia(p_session_token text, p_data date)
returns table (
  id uuid,
  data date,
  turno text,
  tarefa text,
  funcionario_id uuid,
  funcionario_nome text,
  funcionario_apelido text,
  origem text,
  bloqueada boolean,
  status text,
  concluido_por_apelido text,
  concluido_em timestamptz,
  conflito_motivo text
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

  return query
  select
    a.id, a.data, a.turno, a.tarefa,
    a.funcionario_id, f.nome::text, f.apelido::text,
    a.origem, a.bloqueada, a.status,
    fc.apelido::text, a.concluido_em, a.conflito_motivo
  from public.limpeza_atribuicoes a
  left join public.funcionarios f on f.id = a.funcionario_id
  left join public.funcionarios fc on fc.id = a.concluido_por
  where a.data = p_data
  order by
    case a.turno when 'manha' then 0 else 1 end,
    case a.tarefa when 'varrer' then 0 else 1 end;
end;
$$;

revoke all on function public.get_limpeza_dia(text, date) from public;
grant execute on function public.get_limpeza_dia(text, date) to anon;

-- ---------------------------------------------------------------------------
-- get_limpeza_mes — team-visible monthly transparency summary, one row per
-- currently-eligible funcionario, alphabetical (never a leaderboard/ranking).
-- Pure read — does not sync.
-- ---------------------------------------------------------------------------
create or replace function public.get_limpeza_mes(p_session_token text, p_mes date)
returns table (
  funcionario_id uuid,
  funcionario_nome text,
  funcionario_apelido text,
  varrer_atribuidos bigint,
  passar_pano_atribuidos bigint,
  total bigint,
  concluidos bigint,
  pendentes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;

  return query
  select
    f.id, f.nome::text, f.apelido::text,
    count(*) filter (where a.tarefa = 'varrer') as varrer_atribuidos,
    count(*) filter (where a.tarefa = 'passar_pano') as passar_pano_atribuidos,
    count(*) as total,
    count(*) filter (where a.status = 'concluida') as concluidos,
    count(*) filter (where a.status <> 'concluida') as pendentes
  from public.funcionarios f
  join public.limpeza_atribuicoes a
    on a.funcionario_id = f.id and a.data between v_mes_ref and v_mes_fim
  where f.is_active = true
    and f.escala_grupo_gestao = false
    and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
  group by f.id, f.nome, f.apelido
  order by f.apelido;
end;
$$;

revoke all on function public.get_limpeza_mes(text, date) from public;
grant execute on function public.get_limpeza_mes(text, date) to anon;

-- ---------------------------------------------------------------------------
-- get_limpeza_gerencial_mes — Gerente/Administrador only: conflicts, manual
-- overrides, sem_candidato slots, and missed (past, still pendente) rows.
-- Pure read — does not sync.
-- ---------------------------------------------------------------------------
create or replace function public.get_limpeza_gerencial_mes(p_session_token text, p_mes date)
returns table (
  id uuid,
  data date,
  turno text,
  tarefa text,
  funcionario_apelido text,
  origem text,
  bloqueada boolean,
  status text,
  conflito_motivo text,
  atrasada boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_mes_ref date;
  v_mes_fim date;
  v_hoje date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  v_mes_ref := date_trunc('month', p_mes)::date;
  v_mes_fim := (v_mes_ref + interval '1 month' - interval '1 day')::date;
  v_hoje := (now() at time zone 'America/Manaus')::date;

  return query
  select
    a.id, a.data, a.turno, a.tarefa, f.apelido::text,
    a.origem, a.bloqueada, a.status, a.conflito_motivo,
    (a.data < v_hoje and a.status = 'pendente') as atrasada
  from public.limpeza_atribuicoes a
  left join public.funcionarios f on f.id = a.funcionario_id
  where a.data between v_mes_ref and v_mes_fim
    and (
      a.status in ('conflito', 'sem_candidato')
      or a.bloqueada = true
      or (a.data < v_hoje and a.status = 'pendente')
    )
  order by a.data, case a.turno when 'manha' then 0 else 1 end, a.tarefa;
end;
$$;

revoke all on function public.get_limpeza_gerencial_mes(text, date) from public;
grant execute on function public.get_limpeza_gerencial_mes(text, date) to anon;

-- ---------------------------------------------------------------------------
-- limpeza_concluir_atribuicao — assigned employee, OR Gerente/Administrador
-- on their behalf, marks a task done. concluido_por/concluido_em always
-- record who actually pressed Concluído, which may differ from
-- funcionario_id (the original assignee) when a manager completes on
-- someone's behalf — funcionario_id itself is never changed by this RPC, so
-- "who was assigned" and "who completed it" stay independently auditable.
-- Idempotent: completing an already-completed assignment by the same
-- authorized caller returns the existing state rather than erroring or
-- duplicating.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_concluir_atribuicao(
  p_session_token text,
  p_atribuicao_id uuid
)
returns table (
  id uuid,
  status text,
  concluido_por_apelido text,
  concluido_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_row record;
  v_is_manager boolean;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_row from public.limpeza_atribuicoes where id = p_atribuicao_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_NAO_ENCONTRADA';
  end if;

  -- Both Gerente and Administrador may complete on an assigned employee's
  -- behalf; an ordinary employee may only complete their own assignment.
  v_is_manager := v_ctx.cargo in ('Gerente', 'Administrador');
  if v_row.funcionario_id is distinct from v_ctx.id_funcionario and not v_is_manager then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CONCLUIR_LIMPEZA';
  end if;

  if v_row.funcionario_id is null then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_SEM_FUNCIONARIO';
  end if;

  if v_row.status = 'conflito' then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_EM_CONFLITO';
  end if;

  if v_row.status = 'pendente' then
    update public.limpeza_atribuicoes
      set status = 'concluida', concluido_por = v_ctx.id_funcionario, concluido_em = now(),
          atualizado_em = now()
      where public.limpeza_atribuicoes.id = v_row.id;

    select * into v_row from public.limpeza_atribuicoes where public.limpeza_atribuicoes.id = v_row.id;
  end if;
  -- v_row.status = 'concluida' already (either just now, or idempotently
  -- re-requested by the same authorized caller) — fall through and return it.

  return query
  select v_row.id, v_row.status, f.apelido::text, v_row.concluido_em
  from public.funcionarios f
  where f.id = v_row.concluido_por;
end;
$$;

revoke all on function public.limpeza_concluir_atribuicao(text, uuid) from public;
grant execute on function public.limpeza_concluir_atribuicao(text, uuid) to anon;

-- ---------------------------------------------------------------------------
-- limpeza_definir_atribuicao_manual — Gerente/Administrador manual override.
-- Validity is schedule-only (limpeza_funcionario_escalado_turno) — NOT the
-- automatic-rotation cargo/Gestão exclusion, so a manager can deliberately
-- assign e.g. a Gerente. Locks the slot (bloqueada = true) against ordinary
-- automatic recalculation. Refuses to touch an already-completed assignment.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_definir_atribuicao_manual(
  p_session_token text,
  p_data date,
  p_turno text,
  p_tarefa text,
  p_funcionario_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_outro_funcionario uuid;
  v_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;
  if v_ctx.cargo not in ('Gerente', 'Administrador') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_LIMPEZA';
  end if;

  if p_turno not in ('manha', 'tarde') then
    raise exception using errcode = 'P0001', message = 'TURNO_INVALIDO';
  end if;
  if p_tarefa not in ('varrer', 'passar_pano') then
    raise exception using errcode = 'P0001', message = 'TAREFA_INVALIDA';
  end if;

  if not public.limpeza_funcionario_escalado_turno(p_funcionario_id, p_data, p_turno) then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_INDISPONIVEL';
  end if;

  select funcionario_id into v_outro_funcionario
  from public.limpeza_atribuicoes
  where data = p_data and turno = p_turno
    and tarefa <> p_tarefa;

  if v_outro_funcionario is not null and v_outro_funcionario = p_funcionario_id then
    raise exception using errcode = 'P0001', message = 'CONFLITO_MESMA_PESSOA';
  end if;

  insert into public.limpeza_atribuicoes (
    data, turno, tarefa, funcionario_id, origem, bloqueada, status,
    conflito_motivo, criado_por, atualizado_por, atualizado_em
  )
  values (
    p_data, p_turno, p_tarefa, p_funcionario_id, 'manual', true, 'pendente',
    null, v_ctx.id_funcionario, v_ctx.id_funcionario, now()
  )
  on conflict (data, turno, tarefa) do update
    set funcionario_id = excluded.funcionario_id,
        origem = 'manual',
        bloqueada = true,
        status = 'pendente',
        conflito_motivo = null,
        atualizado_por = v_ctx.id_funcionario,
        atualizado_em = now()
    where public.limpeza_atribuicoes.status <> 'concluida'
  returning id into v_id;

  if v_id is null then
    raise exception using errcode = 'P0001', message = 'ATRIBUICAO_CONCLUIDA';
  end if;

  return v_id;
end;
$$;

revoke all on function public.limpeza_definir_atribuicao_manual(text, date, text, text, uuid) from public;
grant execute on function public.limpeza_definir_atribuicao_manual(text, date, text, text, uuid) to anon;

commit;
