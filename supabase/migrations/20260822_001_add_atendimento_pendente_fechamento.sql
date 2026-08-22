begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2D: Atendimento Pendente de Fechamento
-- entre Dias
--
-- Scope (docs/portal-benvisi-blueprint.md section 8.14 / ADR-010): an
-- Atendimento that is still 'ativo' or 'finalizando' when the Manaus
-- business day changes must never keep timing overnight, disappear, or
-- receive an invented outcome. Instead it becomes a durable
-- 'pendente_fechamento' obligation belonging to the original responsible
-- employee (id_funcionario, never id_funcionario_iniciador — section 8),
-- who must complete it — with real customer/checklist information, never
-- an auto-generated one — before doing anything else operational.
--
-- Detection/transition is lazy and server-authoritative (section 7): a new
-- internal helper, transicionar_atendimento_pendente(p_id_funcionario),
-- locks and inspects that employee's own 'ativo'/'finalizando' row (if any)
-- and transitions it in place the moment its original Manaus business day
-- is found to be earlier than today. It is called at the top of every RPC
-- that reads or mutates an employee's own active-Atendimento row — never
-- only from a single "check on login" spot — so the transition is caught
-- regardless of how the employee (re)reaches the backend: a fresh poll, a
-- direct action attempt, a different device, days later. No background
-- scheduler exists or is required.
--
-- Timer/duration semantics (section 5/6) — the key design choice of this
-- migration: finalizando_em already means "the customer-facing duration
-- ends here" for every other completed Atendimento (established by
-- 20260819_002 / ADR-021: final duration = finalizando_em - iniciado_em,
-- which already correctly excludes every abandoned Finalizando cycle and
-- the final successful one). This migration reuses that exact column and
-- formula instead of inventing a new one:
--
--   - if the Atendimento was still 'ativo' at day's end (never entered
--     Finalizando), finalizando_em is synthesized to the end-of-business-
--     day cutoff (local midnight starting the NEXT Manaus day) — exactly
--     "duration ends at the end of the original business day if no earlier
--     valid closing boundary exists" (section 5's preferred principle);
--   - if it was already 'finalizando' (the employee had tapped Concluir
--     atendimento but abandoned/never submitted), finalizando_em already
--     holds a real, same-day, earlier timestamp — an earlier valid closing
--     boundary already exists, so it is left completely untouched.
--
-- Both branches converge on the same historical fact once transitioned:
-- finalizando_em - iniciado_em is the correct, deterministic, already-
-- computed customer-facing duration, usable by ordinary reporting queries
-- with zero special-casing. iniciado_em itself is never touched, matching
-- every prior Finalizando-cycle rule in this schema.
--
-- Recovery completion is a NEW, separate RPC — concluir_atendimento_pendente
-- — rather than forcing this through concluir_atendimento's existing 4-arg
-- signature (section 19). Two concrete reasons this needed to be distinct,
-- not just a conditional branch:
--
--   1. Queue semantics genuinely differ (section 17): concluir_atendimento
--      always computes v_dia as TODAY and upserts the employee back into
--      TODAY's lista_vez_fila. For a recovery completion that may happen
--      days later, doing the same thing would prematurely and incorrectly
--      grant today's Lista da Vez membership without the employee ever
--      having done today's own Iniciar Atividades / Entrar na Lista da Vez.
--      concluir_atendimento_pendente therefore never touches lista_vez_fila
--      or the lista_vez advisory lock at all — today's queue membership
--      stays entirely governed by today's own normal rules, untouched.
--
--   2. Checklist requirement differs (section 13/14): recovery ALWAYS
--      requires full Checklist V1 completion and NEVER offers Farei depois
--      — there is no p_adiar_checklist parameter at all on this function,
--      not merely one forced to false. See the checklist-policy note further
--      below (directly above concluir_atendimento_pendente) for the full
--      reasoning on why this does not conflict with a previously-persisted
--      2C.3 periodic decision.
--
-- Checklist-policy historical integrity (section 13/29): checklist_obrigatorio
-- / checklist_decisao_motivo / checklist_politica_no_momento are NEVER
-- written by transicionar_atendimento_pendente or by
-- concluir_atendimento_pendente. Whatever they already were (including
-- null, for an Atendimento that never reached a periodic decision) remains
-- exactly that historical fact — so a recovered Atendimento can never
-- retroactively acquire, lose, or falsify a 2C.3 periodic decision it did
-- or didn't genuinely receive, and the existing periodic-eligible-history
-- filter (checklist_politica_no_momento = 'periodic_verification' and
-- checklist_obrigatorio is not null) continues to mean exactly what it
-- already meant, with zero special-casing for recovered rows.
--
-- Concurrency/idempotency: no new lock primitive is introduced.
-- transicionar_atendimento_pendente takes the same atendimentos-row
-- `for update` lock every other Atendimento RPC already takes for that
-- employee — first in the established lock order (atendimentos row ->
-- [checklist_config, defer only] -> checklist_pendencias(employee) ->
-- lista_vez(day)) — so calling it at the top of every function below adds
-- no new deadlock path. concluir_atendimento_pendente's own lock order
-- (atendimentos row -> checklist_pendencias(employee), via
-- resolver_checklist_pendencias) is a strict prefix of that same order.
-- The existing partial unique index (widened below to also cover
-- 'pendente_fechamento') already makes it structurally impossible for an
-- employee to ever have more than one row in (ativo, finalizando,
-- pendente_fechamento) at a time — so "more than one pending Atendimento"
-- (section 20) can never actually occur; no extra application-level check
-- is needed for it. The same `for update` + status-match pattern already
-- used by every closing RPC since Milestone 2A gives
-- concluir_atendimento_pendente the same duplicate-submission/cross-device
-- protection for free: a second concurrent call blocks on the row lock,
-- then finds status <> 'pendente_fechamento' once unblocked and fails
-- cleanly with NENHUM_ATENDIMENTO_PENDENTE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- atendimentos: three new nullable columns, populated only once an
-- Atendimento actually transitions into 'pendente_fechamento'.
--   pendente_desde          — when the lazy transition itself happened
--                              (may be well after the original business day
--                              ended — this is the detection moment, not the
--                              cutoff), for section 27 reporting.
--   dia_negocio_original    — the Manaus calendar date the Atendimento
--                              actually belonged to, locked in at transition
--                              time rather than re-derived from iniciado_em
--                              later, so it stays deterministic regardless of
--                              how long the obligation stays unresolved.
--   fim_dia_negocio_original — the synthesized/preserved cutoff instant used
--                              as finalizando_em when no earlier one existed
--                              (see header note above) — kept as its own
--                              column, separate from finalizando_em, purely
--                              so the exact cutoff this migration computed is
--                              itself auditable even in the (Case B) branch
--                              where finalizando_em was left holding a
--                              different, earlier, genuine value instead.
-- -----------------------------------------------------------------------------
alter table public.atendimentos
  add column if not exists pendente_desde timestamptz,
  add column if not exists dia_negocio_original date,
  add column if not exists fim_dia_negocio_original timestamptz;

-- Guarded widen of the status check constraint. Safe without a violation
-- preflight (unlike earlier migrations' widenings): 'pendente_fechamento' is
-- a brand-new value introduced by this migration, so no existing row can
-- possibly already hold it — the only way this ALTER could fail is an
-- existing-data violation of one of the OTHER (unchanged) branches, and
-- those were already enforced by the constraint being replaced.
do $$
declare
  v_already_widened boolean;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.atendimentos'::regclass
      and conname = 'atendimentos_status_check'
      and pg_get_constraintdef(oid) ilike '%pendente_fechamento%'
  ) into v_already_widened;

  if not v_already_widened then
    alter table public.atendimentos drop constraint if exists atendimentos_status_check;
    alter table public.atendimentos
      add constraint atendimentos_status_check
      check (status in ('ativo', 'finalizando', 'pendente_fechamento', 'concluido', 'cancelado'));
  end if;
end $$;

-- Guarded widen of the status/timestamp consistency constraint. Same
-- no-preflight-needed reasoning as above. 'pendente_fechamento' requires
-- finalizando_em to already be populated (true in both Case A and Case B —
-- see transicionar_atendimento_pendente below) alongside the three new
-- columns, and forbids concluido_em/cancelado_em, mirroring 'finalizando'.
do $$
declare
  v_already_widened boolean;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.atendimentos'::regclass
      and conname = 'atendimentos_status_timestamps_consistentes'
      and pg_get_constraintdef(oid) ilike '%pendente_fechamento%'
  ) into v_already_widened;

  if not v_already_widened then
    alter table public.atendimentos
      drop constraint if exists atendimentos_status_timestamps_consistentes;

    alter table public.atendimentos
      add constraint atendimentos_status_timestamps_consistentes check (
        (status = 'ativo' and finalizando_em is null and concluido_em is null and cancelado_em is null)
        or (status = 'finalizando' and finalizando_em is not null and concluido_em is null and cancelado_em is null)
        or (status = 'pendente_fechamento'
            and finalizando_em is not null
            and concluido_em is null
            and cancelado_em is null
            and pendente_desde is not null
            and dia_negocio_original is not null
            and fim_dia_negocio_original is not null)
        or (status = 'concluido' and concluido_em is not null and cancelado_em is null)
        or (status = 'cancelado' and cancelado_em is not null and concluido_em is null and finalizando_em is null)
      );
  end if;
end $$;

-- Guarded widen of the one-active-Atendimento-per-employee partial unique
-- index to also cover 'pendente_fechamento' — a pending recovery obligation
-- blocks a new Atendimento exactly as much as an ativo/finalizando one does
-- (section 3/8/20). Same no-preflight-needed reasoning as the constraints
-- above.
do $$
declare
  v_already_widened boolean;
begin
  select exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.atendimentos'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%id_funcionario%'
      and pg_get_indexdef(i.indexrelid) ilike '%pendente_fechamento%'
  ) into v_already_widened;

  if not v_already_widened then
    drop index if exists public.atendimentos_um_ativo_por_funcionario_idx;
    create unique index atendimentos_um_ativo_por_funcionario_idx
      on public.atendimentos (id_funcionario)
      where status in ('ativo', 'finalizando', 'pendente_fechamento');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- transicionar_atendimento_pendente — internal helper (never granted to
-- anon, same convention as resolver_checklist_pendencias), called at the top
-- of every RPC below that reads or mutates an employee's own active
-- Atendimento row. A fast no-op whenever there is nothing to transition (no
-- ativo/finalizando row at all, or one that still belongs to today) — see
-- header note above for the full Case A / Case B duration reasoning.
-- -----------------------------------------------------------------------------
create or replace function public.transicionar_atendimento_pendente(
  p_id_funcionario uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atendimento record;
  v_dia_hoje date;
  v_dia_original date;
  v_fim_dia timestamptz;
begin
  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = p_id_funcionario
    and status in ('ativo', 'finalizando')
  for update;

  if v_atendimento.id is null then
    return;
  end if;

  v_dia_hoje := (now() at time zone 'America/Manaus')::date;
  v_dia_original := (v_atendimento.iniciado_em at time zone 'America/Manaus')::date;

  if v_dia_original >= v_dia_hoje then
    return;
  end if;

  -- The instant of local midnight starting the day AFTER v_dia_original —
  -- i.e. the end of v_dia_original's own Manaus business day.
  v_fim_dia := (v_dia_original + 1)::timestamp at time zone 'America/Manaus';

  if v_atendimento.status = 'ativo' then
    -- Case A: no closing boundary exists yet — synthesize one at the
    -- business-day cutoff, reusing finalizando_em/the existing duration
    -- formula rather than inventing a new one.
    update public.atendimentos
    set status = 'pendente_fechamento',
        finalizando_em = v_fim_dia,
        pendente_desde = now(),
        dia_negocio_original = v_dia_original,
        fim_dia_negocio_original = v_fim_dia
    where id = v_atendimento.id;
  else
    -- Case B: finalizando_em already holds a real, earlier, same-day
    -- timestamp from when the employee originally tapped Concluir
    -- atendimento — an earlier valid closing boundary already exists, so it
    -- is preserved untouched.
    update public.atendimentos
    set status = 'pendente_fechamento',
        pendente_desde = now(),
        dia_negocio_original = v_dia_original,
        fim_dia_negocio_original = v_fim_dia
    where id = v_atendimento.id;
  end if;
end;
$$;

revoke all on function public.transicionar_atendimento_pendente(uuid) from public;
-- Deliberately NOT granted to anon — internal helper only, called from
-- within the SECURITY DEFINER RPCs below.

-- -----------------------------------------------------------------------------
-- get_atendimento_ativo: now also matches 'pendente_fechamento' and returns
-- dia_negocio_original (null unless pending — needed for the recovery
-- screen's contextual date copy, e.g. "Atendimento iniciado em 21/08").
-- Calls the transition helper first, so simply polling this (as every page
-- already does every 5s) is by itself enough to discover and perform the
-- transition — no separate "check on login" code path is needed. No longer
-- STABLE: this function can now have a side effect (the transition), so it
-- must not be treated as side-effect-free by the planner. Requires DROP +
-- CREATE — new output column, same convention as every prior evolution of
-- this function.
-- -----------------------------------------------------------------------------
drop function if exists public.get_atendimento_ativo(text);

create function public.get_atendimento_ativo(
  p_session_token text
)
returns table (
  id uuid,
  status text,
  iniciado_em timestamptz,
  fora_de_ordem boolean,
  prazo_provisorio_em timestamptz,
  iniciado_por_nome text,
  checklist_obrigatorio boolean,
  dia_negocio_original date
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

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  return query
    select
      a.id,
      a.status,
      a.iniciado_em,
      a.fora_de_ordem,
      a.iniciado_em + make_interval(
        secs => case when a.id_funcionario_iniciador <> a.id_funcionario then 60 else 20 end
      ),
      case when a.id_funcionario_iniciador <> a.id_funcionario then fi.nome::text else null end,
      a.checklist_obrigatorio,
      a.dia_negocio_original
    from public.atendimentos a
    left join public.funcionarios fi on fi.id = a.id_funcionario_iniciador
    where a.id_funcionario = v_ctx.id_funcionario
      and a.status in ('ativo', 'finalizando', 'pendente_fechamento')
    limit 1;
end;
$$;

revoke all on function public.get_atendimento_ativo(text) from public;
grant execute on function public.get_atendimento_ativo(text) to anon;

-- -----------------------------------------------------------------------------
-- iniciar_atendimento: same 3-arg signature as 20260819_004. Two additions
-- only — the transition-helper call (for v_id_alvo, covering both self and
-- delegated-start targets uniformly, exactly like every existing check in
-- this function already does) right after v_id_alvo is resolved, and a new
-- distinct error (ATENDIMENTO_PENDENTE_FECHAMENTO) when the blocking row
-- turns out to be a pending recovery obligation rather than an ordinary
-- ativo/finalizando Atendimento — so the frontend/employee gets routed
-- toward recovery rather than a generic "already in progress" message.
-- Everything else is byte-for-byte unchanged from 20260819_004.
-- -----------------------------------------------------------------------------
create or replace function public.iniciar_atendimento(
  p_session_token text,
  p_confirmar_fora_de_ordem boolean default false,
  p_id_funcionario_alvo uuid default null
)
returns table (
  id uuid,
  iniciado_em timestamptz,
  fora_de_ordem boolean,
  prazo_provisorio_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_dia date;
  v_id_alvo uuid;
  v_primeiro_id uuid;
  v_fora_de_ordem boolean;
  v_atendimento record;
  v_grace_seconds int;
  v_status_existente text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_id_alvo := coalesce(p_id_funcionario_alvo, v_ctx.id_funcionario);

  if v_id_alvo <> v_ctx.id_funcionario then
    if not exists (
      select 1 from public.funcionarios fa where fa.id = v_id_alvo and fa.is_active = true
    ) then
      raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INVALIDO';
    end if;
  end if;

  -- Milestone 2D: closes the day-boundary race (section 22) — a call
  -- arriving right after midnight always sees the authoritative
  -- post-transition state below, never a stale ativo/finalizando row.
  perform public.transicionar_atendimento_pendente(v_id_alvo);

  v_dia := (now() at time zone 'America/Manaus')::date;

  if not exists (
    select 1
    from public.turno_presenca
    where id_funcionario = v_id_alvo
      and (checked_in_at at time zone 'America/Manaus')::date = v_dia
  ) then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  if not exists (
    select 1 from public.lista_vez_fila
    where id_funcionario = v_id_alvo and dia_manaus = v_dia and disponivel = true
  ) then
    raise exception using errcode = 'P0001', message = 'FUNCIONARIO_ALVO_INDISPONIVEL';
  end if;

  select id_funcionario into v_primeiro_id
  from public.lista_vez_fila
  where dia_manaus = v_dia and disponivel = true
  order by posicao asc
  limit 1;

  v_fora_de_ordem := (v_primeiro_id is distinct from v_id_alvo);

  if v_fora_de_ordem and not p_confirmar_fora_de_ordem then
    raise exception using errcode = 'P0001', message = 'CONFIRMACAO_FORA_DE_ORDEM_NECESSARIA';
  end if;

  select a.status into v_status_existente
  from public.atendimentos a
  where a.id_funcionario = v_id_alvo and a.status in ('ativo', 'finalizando', 'pendente_fechamento')
  limit 1;

  if v_status_existente = 'pendente_fechamento' then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_PENDENTE_FECHAMENTO';
  elsif v_status_existente is not null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end if;

  update public.lista_vez_fila
  set disponivel = false, atualizado_em = now()
  where id_funcionario = v_id_alvo and dia_manaus = v_dia;

  begin
    insert into public.atendimentos (id_funcionario, id_funcionario_iniciador, fora_de_ordem)
    values (v_id_alvo, v_ctx.id_funcionario, v_fora_de_ordem)
    returning atendimentos.id, atendimentos.iniciado_em, atendimentos.fora_de_ordem
    into v_atendimento;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end;

  v_grace_seconds := case when v_ctx.id_funcionario <> v_id_alvo then 60 else 20 end;

  return query select
    v_atendimento.id,
    v_atendimento.iniciado_em,
    v_atendimento.fora_de_ordem,
    v_atendimento.iniciado_em + make_interval(secs => v_grace_seconds);
end;
$$;

revoke all on function public.iniciar_atendimento(text, boolean, uuid) from public;
grant execute on function public.iniciar_atendimento(text, boolean, uuid) to anon;

-- -----------------------------------------------------------------------------
-- iniciar_fechamento_atendimento: same 1-arg signature as 20260821_004. Only
-- addition is the transition-helper call, first thing after session
-- resolution — this is the single most important call site for section 5's
-- core concern: without it, a request arriving after the day boundary on a
-- still-'ativo' row would set finalizando_em = now() (today), making the
-- eventual customer-facing duration include the entire overnight gap.
-- Everything else (the 2C.3 periodic-decision logic and the final status
-- transition) is byte-for-byte unchanged from 20260821_004.
-- -----------------------------------------------------------------------------
create or replace function public.iniciar_fechamento_atendimento(
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_politica text;
  v_obrigatorio boolean;
  v_motivo text;
  v_ultimas boolean[];
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'ativo'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  if v_atendimento.checklist_obrigatorio is null then
    select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

    if v_politica = 'periodic_verification' then
      select array_agg(h.checklist_obrigatorio order by h.checklist_decisao_em desc)
      into v_ultimas
      from (
        select a2.checklist_obrigatorio, a2.checklist_decisao_em
        from public.atendimentos a2
        where a2.id_funcionario = v_ctx.id_funcionario
          and a2.checklist_politica_no_momento = 'periodic_verification'
          and a2.checklist_obrigatorio is not null
        order by a2.checklist_decisao_em desc
        limit 3
      ) h;

      if v_ultimas is not null and v_ultimas[1] then
        v_obrigatorio := false;
        v_motivo := 'pos_obrigatorio';
      elsif array_length(v_ultimas, 1) = 3
        and not v_ultimas[1] and not v_ultimas[2] and not v_ultimas[3] then
        v_obrigatorio := true;
        v_motivo := 'gap_maximo';
      else
        v_obrigatorio := (random() < 0.20);
        v_motivo := case when v_obrigatorio then 'sorteio' else 'nao_selecionado' end;
      end if;

      update public.atendimentos
      set checklist_obrigatorio = v_obrigatorio,
          checklist_decisao_motivo = v_motivo,
          checklist_decisao_em = now(),
          checklist_politica_no_momento = v_politica
      where id = v_atendimento.id;
    end if;
  end if;

  update public.atendimentos
  set status = 'finalizando', finalizando_em = now()
  where id = v_atendimento.id;

  return true;
end;
$$;

revoke all on function public.iniciar_fechamento_atendimento(text) from public;
grant execute on function public.iniciar_fechamento_atendimento(text) to anon;

-- -----------------------------------------------------------------------------
-- voltar_ao_atendimento: same 1-arg signature as 20260819_002. Only addition
-- is the transition-helper call first — without it, a stale 'finalizando'
-- page for a since-transitioned Atendimento could revert it back to 'ativo'
-- and clear finalizando_em, destroying the historical closing boundary the
-- transition just established. With it, the lookup below correctly finds
-- nothing (status is now 'pendente_fechamento') and raises the existing
-- ATENDIMENTO_NAO_ESTA_FINALIZANDO error instead.
-- -----------------------------------------------------------------------------
create or replace function public.voltar_ao_atendimento(
  p_session_token text
)
returns boolean
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

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  update public.atendimentos
  set status = 'ativo',
      tempo_finalizando_abandonado = tempo_finalizando_abandonado + (now() - finalizando_em),
      finalizando_em = null
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando';

  if not found then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  return true;
end;
$$;

revoke all on function public.voltar_ao_atendimento(text) from public;
grant execute on function public.voltar_ao_atendimento(text) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento: same 4-arg signature as 20260821_004. Only addition
-- is the transition-helper call first — without it, a stale 'finalizando'
-- page for a since-transitioned Atendimento could complete using TODAY's
-- date for the Lista da Vez return (section 17), incorrectly granting
-- today's queue membership. Everything else — customer validation, the
-- 2C.3 checklist_obrigatorio-first / live-policy-fallback deferral gate,
-- the complete-now path, backlog resolution — is byte-for-byte unchanged
-- from 20260821_004.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_atendimento(
  p_session_token text,
  p_clientes jsonb,
  p_checklist jsonb,
  p_adiar_checklist boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_dia date;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_politica text;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'finalizando'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_NAO_ESTA_FINALIZANDO';
  end if;

  -- Customer outcomes — unchanged since 20260821_001.
  if p_clientes is null
     or jsonb_typeof(p_clientes) <> 'array'
     or jsonb_array_length(p_clientes) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_CLIENTE_INFORMADO';
  end if;

  for v_cliente in select * from jsonb_array_elements(p_clientes)
  loop
    if v_cliente ->> 'id_motivo' is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
    end if;

    begin
      v_id_motivo := (v_cliente ->> 'id_motivo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end;

    select * into v_motivo
    from public.atendimento_motivos
    where id = v_id_motivo and ativo = true;

    if v_motivo.id is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end if;

    v_detalhe := nullif(trim(both from (v_cliente ->> 'detalhe')), '');

    if v_motivo.detalhe_obrigatorio and v_detalhe is null then
      raise exception using errcode = 'P0001', message = 'DETALHE_OBRIGATORIO';
    end if;

    insert into public.atendimento_clientes (
      id_atendimento, id_motivo, categoria, motivo_rotulo, detalhe
    ) values (
      v_atendimento.id, v_motivo.id, v_motivo.categoria, v_motivo.rotulo, v_detalhe
    );
  end loop;

  -- Active checklist version — always resolved fresh, shared by both
  -- branches below.
  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_adiar_checklist then
    if v_atendimento.checklist_obrigatorio is not null then
      if v_atendimento.checklist_obrigatorio then
        raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
      end if;
    else
      select cc.policy into v_politica from public.checklist_config cc where cc.id = 1 for share;

      if v_politica is distinct from 'defer_allowed' then
        raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
      end if;
    end if;

    perform pg_advisory_xact_lock(
      hashtext('checklist_pendencias:' || v_ctx.id_funcionario::text)::bigint
    );

    insert into public.checklist_pendencias (
      id_atendimento, id_funcionario, checklist_versao, politica_no_momento, status
    ) values (
      v_atendimento.id,
      v_ctx.id_funcionario,
      v_versao_ativa,
      coalesce(v_atendimento.checklist_politica_no_momento, v_politica),
      'pending'
    );
  else
    if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
      raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
    end if;

    select array_agg(elem ->> 'codigo')
    into v_codigos_confirmados
    from jsonb_array_elements(p_checklist) as elem
    where jsonb_typeof(elem) = 'object'
      and jsonb_typeof(elem -> 'concluido') = 'boolean'
      and (elem ->> 'concluido')::boolean is true
      and elem ->> 'codigo' is not null;

    if exists (
      select 1
      from public.atendimento_checklist_itens ci
      where ci.versao = v_versao_ativa
        and ci.ativo = true
        and ci.obrigatorio = true
        and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    ) then
      raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'codigo', ci.codigo,
        'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
      )
      order by ci.ordem_exibicao
    )
    into v_respostas
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa and ci.ativo = true;

    insert into public.atendimento_checklists (id_atendimento, id_funcionario, versao, respostas)
    values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas)
    returning id into v_checklist_id;

    perform public.resolver_checklist_pendencias(
      v_ctx.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
    );
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido',
      concluido_em = now()
  where id = v_atendimento.id;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, na_fila, disponivel, posicao)
  values (v_ctx.id_funcionario, v_dia, true, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    na_fila = true,
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  return true;
end;
$$;

revoke all on function public.concluir_atendimento(text, jsonb, jsonb, boolean) from public;
grant execute on function public.concluir_atendimento(text, jsonb, jsonb, boolean) to anon;

-- -----------------------------------------------------------------------------
-- concluir_checklist_avulso: same 2-arg signature as 20260821_003. Two
-- additions — the transition-helper call first, and the existing
-- active-Atendimento block-check widened to also cover
-- 'pendente_fechamento' (section 16: the unresolved Atendimento takes
-- operational precedence — an employee should not be able to use the
-- standalone checklist escape hatch to clear backlog while a pending
-- Atendimento recovery obligation sits unresolved; recovering it already
-- resolves that same backlog anyway, per section 15, so nothing is lost).
-- Reuses the existing ATENDIMENTO_ATIVO_IMPEDE_CHECKLIST_AVULSO message,
-- which already reads correctly ("conclua seu atendimento atual...") for
-- this case too.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_checklist_avulso(
  p_session_token text,
  p_checklist jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_conclusao_id uuid;
  v_resolved_count int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  perform public.transicionar_atendimento_pendente(v_ctx.id_funcionario);

  if exists (
    select 1 from public.atendimentos
    where id_funcionario = v_ctx.id_funcionario
      and status in ('ativo', 'finalizando', 'pendente_fechamento')
  ) then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_IMPEDE_CHECKLIST_AVULSO';
  end if;

  if not exists (
    select 1 from public.checklist_pendencias
    where id_funcionario = v_ctx.id_funcionario and status = 'pending'
  ) then
    raise exception using errcode = 'P0001', message = 'SEM_CHECKLIST_PENDENTE';
  end if;

  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select array_agg(elem ->> 'codigo')
  into v_codigos_confirmados
  from jsonb_array_elements(p_checklist) as elem
  where jsonb_typeof(elem) = 'object'
    and jsonb_typeof(elem -> 'concluido') = 'boolean'
    and (elem ->> 'concluido')::boolean is true
    and elem ->> 'codigo' is not null;

  if exists (
    select 1
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa
      and ci.ativo = true
      and ci.obrigatorio = true
      and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'codigo', ci.codigo,
      'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    )
    order by ci.ordem_exibicao
  )
  into v_respostas
  from public.atendimento_checklist_itens ci
  where ci.versao = v_versao_ativa and ci.ativo = true;

  insert into public.checklist_conclusoes_avulsas (
    id_funcionario, id_funcionario_ator, versao, respostas
  ) values (
    v_ctx.id_funcionario, v_ctx.id_funcionario, v_versao_ativa, v_respostas
  )
  returning id into v_conclusao_id;

  v_resolved_count := public.resolver_checklist_pendencias(
    v_ctx.id_funcionario, 'checklist_avulso', null, v_conclusao_id, v_versao_ativa
  );

  return v_resolved_count;
end;
$$;

revoke all on function public.concluir_checklist_avulso(text, jsonb) from public;
grant execute on function public.concluir_checklist_avulso(text, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento_pendente — NEW. Recovery completion for a
-- 'pendente_fechamento' Atendimento (section 12/18). Customer-outcome
-- validation/persistence is identical to concluir_atendimento's; the
-- checklist requirement is unconditional — there is no p_adiar_checklist
-- parameter at all, matching section 14's preferred MVP rule (no Farei
-- depois during recovery, full stop).
--
-- Why this does not conflict with a previously-persisted 2C.3 periodic
-- decision (section 13/14, "if there is a genuine architectural conflict...
-- stop and flag it"): checklist_obrigatorio = false means "this Atendimento
-- is not exempt from Farei depois being offered" — it has never meant "this
-- Atendimento can never be required to complete its checklist under any
-- circumstance". Farei depois itself was never a permanent waiver even in
-- the ordinary same-day case (2C.1/2C.2: a deferral only ever creates
-- another durable obligation that must eventually be resolved). Recovery's
-- always-require rule operates on a completely different axis — "this
-- Atendimento's closing was already deferred unintentionally across a
-- business-day boundary, so this specific completion path does not also
-- offer a same-day-style deferral" — and is simply a stricter, always-
-- compatible superset of what a non-mandatory (or no) periodic decision
-- would have allowed same-day, never a contradiction of it. checklist_
-- obrigatorio/checklist_decisao_motivo/checklist_politica_no_momento are
-- therefore left completely untouched by this function (see below), so the
-- historical fact of what 2C.3 actually decided — or that it never decided
-- anything at all — remains exactly, permanently correct for section 29's
-- future periodic-sampling-history purposes. This was judged a coherent,
-- non-arbitrary resolution rather than a genuine blocking ambiguity.
--
-- No lista_vez_fila / lista_vez advisory lock anywhere in this function —
-- see header note above (section 17). No transicionar_atendimento_pendente
-- call is needed here: this function only ever matches status =
-- 'pendente_fechamento' to begin with, a state the transition helper itself
-- produces and this function never further ages — there is no later
-- transition this row could still be waiting for.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_atendimento_pendente(
  p_session_token text,
  p_clientes jsonb,
  p_checklist jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_atendimento record;
  v_cliente jsonb;
  v_id_motivo uuid;
  v_detalhe text;
  v_motivo record;
  v_versao_ativa int;
  v_codigos_confirmados text[];
  v_respostas jsonb;
  v_checklist_id uuid;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  -- Section 8: only the responsible employee (id_funcionario) may recover
  -- their own pending Atendimento — this lookup itself is the enforcement,
  -- id_funcionario_iniciador is never consulted here.
  select * into v_atendimento
  from public.atendimentos
  where id_funcionario = v_ctx.id_funcionario and status = 'pendente_fechamento'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_PENDENTE';
  end if;

  -- Customer outcomes — identical validation/persistence to
  -- concluir_atendimento.
  if p_clientes is null
     or jsonb_typeof(p_clientes) <> 'array'
     or jsonb_array_length(p_clientes) = 0 then
    raise exception using errcode = 'P0001', message = 'NENHUM_CLIENTE_INFORMADO';
  end if;

  for v_cliente in select * from jsonb_array_elements(p_clientes)
  loop
    if v_cliente ->> 'id_motivo' is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_OBRIGATORIO';
    end if;

    begin
      v_id_motivo := (v_cliente ->> 'id_motivo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end;

    select * into v_motivo
    from public.atendimento_motivos
    where id = v_id_motivo and ativo = true;

    if v_motivo.id is null then
      raise exception using errcode = 'P0001', message = 'MOTIVO_INVALIDO';
    end if;

    v_detalhe := nullif(trim(both from (v_cliente ->> 'detalhe')), '');

    if v_motivo.detalhe_obrigatorio and v_detalhe is null then
      raise exception using errcode = 'P0001', message = 'DETALHE_OBRIGATORIO';
    end if;

    insert into public.atendimento_clientes (
      id_atendimento, id_motivo, categoria, motivo_rotulo, detalhe
    ) values (
      v_atendimento.id, v_motivo.id, v_motivo.categoria, v_motivo.rotulo, v_detalhe
    );
  end loop;

  -- Checklist — always required (see function-level comment above for why
  -- this does not conflict with any historical 2C.3 decision).
  -- checklist_obrigatorio / checklist_decisao_motivo /
  -- checklist_politica_no_momento are intentionally never written anywhere
  -- in this function.
  select max(ci.versao) into v_versao_ativa
  from public.atendimento_checklist_itens ci
  where ci.ativo = true;

  if v_versao_ativa is null then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INDISPONIVEL';
  end if;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select array_agg(elem ->> 'codigo')
  into v_codigos_confirmados
  from jsonb_array_elements(p_checklist) as elem
  where jsonb_typeof(elem) = 'object'
    and jsonb_typeof(elem -> 'concluido') = 'boolean'
    and (elem ->> 'concluido')::boolean is true
    and elem ->> 'codigo' is not null;

  if exists (
    select 1
    from public.atendimento_checklist_itens ci
    where ci.versao = v_versao_ativa
      and ci.ativo = true
      and ci.obrigatorio = true
      and not (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_INCOMPLETO';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'codigo', ci.codigo,
      'concluido', (ci.codigo = any(coalesce(v_codigos_confirmados, array[]::text[])))
    )
    order by ci.ordem_exibicao
  )
  into v_respostas
  from public.atendimento_checklist_itens ci
  where ci.versao = v_versao_ativa and ci.ativo = true;

  insert into public.atendimento_checklists (id_atendimento, id_funcionario, versao, respostas)
  values (v_atendimento.id, v_ctx.id_funcionario, v_versao_ativa, v_respostas)
  returning id into v_checklist_id;

  -- Reuses the exact 2C.2 resolver — a genuine checklist completion during
  -- recovery resolves all of this employee's currently-pending checklist
  -- backlog too (section 15), no duplicated logic.
  perform public.resolver_checklist_pendencias(
    v_ctx.id_funcionario, 'fechamento_atendimento', v_checklist_id, null, v_versao_ativa
  );

  -- finalizando_em is deliberately never touched here — see header note
  -- above for why it already holds the correct historical closing boundary
  -- (either the original Finalizando-entry timestamp, or the synthesized
  -- end-of-business-day cutoff), making the existing
  -- finalizando_em - iniciado_em formula correct with no special case.
  --
  -- No lista_vez_fila / lista_vez lock — see header note above (section 17).
  update public.atendimentos
  set status = 'concluido',
      concluido_em = now()
  where id = v_atendimento.id;

  return true;
end;
$$;

revoke all on function public.concluir_atendimento_pendente(text, jsonb, jsonb) from public;
grant execute on function public.concluir_atendimento_pendente(text, jsonb, jsonb) to anon;

commit;
