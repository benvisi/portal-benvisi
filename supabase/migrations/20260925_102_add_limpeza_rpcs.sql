begin;

-- =============================================================================
-- Limpeza V1 — generation, synchronization, completion and read RPCs.
--
-- FAIRNESS ALGORITHM (documented here since it lives entirely in SQL):
-- when a (data, turno, tarefa) slot needs a new automatic assignment, the
-- pool of candidates is every funcionario who is: active, scheduled
-- 'trabalho' that date, whose shift classifies (via escala_classificar_turno)
-- as that turno, whose cargo is not in limpeza_cargos_excluidos, and who is
-- not in the Gestão schedule group — minus whoever is already assigned to
-- the OTHER tarefa in the same (data, turno) slot. Candidates are ranked,
-- ascending, by:
--   1. whether they already have ANY limpeza assignment on data - 1 (avoid
--      unnecessary repeats on consecutive days);
--   2. how many assignments of THIS SAME tarefa they already have this month;
--   3. how many limpeza assignments of any tarefa they already have this
--      month (total workload);
--   4. apelido, then id — deterministic, auditable tie-break.
-- The first candidate after that sort is assigned. Varrer is resolved before
-- Passar pano within the same slot so Passar pano's selection can exclude
-- Varrer's pick for that slot.
--
-- SYNCHRONIZATION: nothing runs on a schedule or is hooked into Escala's
-- publish flow. Instead, every read of a given date (get_limpeza_dia) or
-- month (get_limpeza_mes / get_limpeza_gerencial_mes) first reconciles that
-- date range via limpeza_sincronizar_dia/periodo, but ONLY for data >= today
-- (Manaus) — dates in the past, and any row already status = 'concluida',
-- are never touched. A manual (bloqueada) assignment is never overwritten by
-- this reconciliation: if the manually assigned employee stops being
-- available (inactive, no longer scheduled, or reclassified to a different
-- turno), the row is flipped to status = 'conflito' instead, surfacing it to
-- management rather than silently reassigning.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- limpeza_funcionario_elegivel — is this funcionario currently working this
-- data/turno, and (when p_regras_automaticas) eligible for the automatic
-- rotation? Manual overrides only need "actually working that shift, active"
-- — cargo/Gestão exclusions apply only to the automatic algorithm, since a
-- manager's deliberate choice is a different kind of decision.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_funcionario_elegivel(
  p_funcionario_id uuid,
  p_data date,
  p_turno text,
  p_regras_automaticas boolean
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
      and public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento) = p_turno
      and (
        not p_regras_automaticas
        or (
          f.escala_grupo_gestao = false
          and not exists (select 1 from public.limpeza_cargos_excluidos x where x.cargo = f.cargo)
        )
      )
  );
$$;

revoke all on function public.limpeza_funcionario_elegivel(uuid, date, text, boolean) from public;

-- ---------------------------------------------------------------------------
-- limpeza_proximo_candidato — the fairness ranking documented above.
-- ---------------------------------------------------------------------------
create or replace function public.limpeza_proximo_candidato(
  p_data date,
  p_turno text,
  p_tarefa text,
  p_excluir_funcionario_id uuid
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
      and public.escala_classificar_turno(e.hora_inicio, e.hora_fim, h.abertura, h.fechamento) = p_turno
      and (p_excluir_funcionario_id is null or f.id <> p_excluir_funcionario_id)
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

revoke all on function public.limpeza_proximo_candidato(date, text, text, uuid) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_dia — reconcile one date's four slots (manha/tarde x
-- varrer/passar_pano). Internal; called by the public read RPCs below.
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
  v_outro_funcionario uuid;
  v_candidato uuid;
  v_status text;
  v_found boolean;
begin
  foreach v_turno in array array['manha', 'tarde'] loop
    v_outro_funcionario := null;

    foreach v_tarefa in array array['varrer', 'passar_pano'] loop
      select * into v_row
      from public.limpeza_atribuicoes
      where data = p_data and turno = v_turno and tarefa = v_tarefa
      for update;
      v_found := found;

      if v_found and v_row.status = 'concluida' then
        v_outro_funcionario := v_row.funcionario_id;
        continue;
      end if;

      if v_found and v_row.bloqueada then
        if v_row.funcionario_id is not null
           and public.limpeza_funcionario_elegivel(v_row.funcionario_id, p_data, v_turno, false) then
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
        v_outro_funcionario := v_row.funcionario_id;
        continue;
      end if;

      -- Automatic slot, still valid: leave untouched.
      if v_found
         and v_row.funcionario_id is not null
         and public.limpeza_funcionario_elegivel(v_row.funcionario_id, p_data, v_turno, true) then
        v_outro_funcionario := v_row.funcionario_id;
        continue;
      end if;

      -- Needs a (re)assignment.
      v_candidato := public.limpeza_proximo_candidato(p_data, v_turno, v_tarefa, v_outro_funcionario);

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

      v_outro_funcionario := v_candidato;
    end loop;
  end loop;
end;
$$;

revoke all on function public.limpeza_sincronizar_dia(date) from public;

-- ---------------------------------------------------------------------------
-- limpeza_sincronizar_periodo — sync every date >= today (Manaus) within
-- [p_data_inicio, p_data_fim]. Past dates are never touched.
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
-- get_limpeza_dia — one day's four slots, team-visible (transparency: any
-- authenticated employee sees the whole day, same as the worked example in
-- the product brief). Syncs first when p_data is today or a future date.
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

  perform public.limpeza_sincronizar_periodo(p_data, p_data);

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
-- Syncs the future portion of the month first.
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

  perform public.limpeza_sincronizar_periodo(v_mes_ref, v_mes_fim);

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

  perform public.limpeza_sincronizar_periodo(v_mes_ref, v_mes_fim);

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
-- limpeza_concluir_atribuicao — assigned employee (or Gerente/Administrador
-- on their behalf, mirroring Atendimento's conclusão gerencial precedent)
-- marks a task done. Idempotent: completing an already-completed assignment
-- by the same authorized caller returns the existing state rather than
-- erroring or duplicating.
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
-- Locks the slot (bloqueada = true) against ordinary automatic
-- recalculation. Refuses to touch an already-completed assignment.
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

  if not public.limpeza_funcionario_elegivel(p_funcionario_id, p_data, p_turno, false) then
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
