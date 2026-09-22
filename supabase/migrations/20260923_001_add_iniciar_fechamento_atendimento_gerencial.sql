begin;

-- =============================================================================
-- Epic 2 — Atendimento: Conclusão Gerencial correction — takeover from
-- em_atendimento (not just finalizando)
--
-- Browser QA on commit 38d7495 found that the manager/admin completion
-- action only appeared once the salesperson themselves had already tapped
-- "Concluir atendimento" (i.e. their own Atendimento had already reached
-- 'finalizando'). That does not solve the real incident this feature exists
-- for: a salesperson stuck in 'em_atendimento' who lost Portal access and
-- therefore could never tap "Concluir atendimento" themselves in the first
-- place — nothing in 38d7495 could ever advance their Atendimento out of
-- 'em_atendimento' on their behalf.
--
-- The employee's own em_atendimento -> finalizando transition is performed
-- by iniciar_fechamento_atendimento (20260818_001, most recently revised in
-- 20260822_001 to also call transicionar_atendimento_pendente first): it
-- locks the caller's own 'ativo' row, resolves the Milestone 2C.3 periodic-
-- checklist-verification decision if this Atendimento hasn't made one yet,
-- then sets status = 'finalizando' and finalizando_em = now() — this
-- finalizando_em timestamp is what "stops the timer": every duration/
-- reporting calculation in this schema already uses finalizando_em -
-- iniciado_em as the customer-facing duration (ADR-021, reused as-is by the
-- 20260822_001 pendente_fechamento synthesis), never a live "now()" while
-- 'ativo'. There is no separate "duration" column to freeze — writing
-- finalizando_em IS what stops it.
--
-- This migration adds iniciar_fechamento_atendimento_gerencial, a new
-- SECURITY DEFINER RPC that performs exactly that same transition (same
-- periodic-checklist-decision logic, same finalizando_em = now() semantics)
-- against an explicit p_id_atendimento instead of the caller's own row,
-- gated by the same cargo check as concluir_atendimento_gerencial
-- (v_ctx.cargo in ('Administrador', 'Gerente')). The subsequent closing
-- form submission is unchanged — concluir_atendimento_gerencial (38d7495)
-- already works against any 'finalizando' row regardless of who or what put
-- it there, so no changes to that function are needed for the takeover
-- itself to feed into it.
--
-- New audit column — id_funcionario_iniciou_fechamento: the task's worked
-- example ("Joshua advances Graça's Atendimento to finalizando, but Wilson
-- later completes the form") is a real, expected scenario once takeover and
-- final completion can happen as two separate actions by two different
-- managers at two different times. id_funcionario_concluiu (38d7495) alone
-- cannot capture Joshua's intervention — it would silently look identical
-- to Wilson having done everything alone. This follows the exact same
-- established convention as every other per-action actor column in this
-- schema (id_funcionario_iniciador for the original start,
-- id_funcionario_cancelou for a cancellation, id_funcionario_concluiu for
-- the final completion): one nullable FK per distinct action, always
-- populated from the server-validated session, never from the client.
-- Populated on every em_atendimento -> finalizando transition from this
-- point on — self-service included (iniciar_fechamento_atendimento is
-- updated below too) — for the same "uniform going forward" reasoning
-- 38d7495 applied to id_funcionario_concluiu. Cleared back to null by
-- voltar_ao_atendimento, exactly like finalizando_em itself: re-entering
-- finalizando later (by anyone) is a fresh closing episode deserving its
-- own fresh answer to "who initiated this particular finalizando", not a
-- stale one from an abandoned attempt.
--
-- Concurrency: identical `for update` + status = 'ativo' match as
-- iniciar_fechamento_atendimento already uses for the self-service case.
-- Whichever of (the employee's own self-service tap, a manager's takeover,
-- a second manager's takeover) commits its row lock first wins; every other
-- concurrent attempt's status = 'ativo' match then fails to find the row
-- (it is already 'finalizando') and raises the existing NENHUM_ATENDIMENTO_ATIVO
-- error cleanly — no double transition, no lost update, nothing to
-- reconcile. This is the same pattern already relied on throughout this
-- feature (iniciar_atendimento, cancelar_atendimento_provisorio,
-- concluir_atendimento_gerencial) and needs no new locking primitive.
-- =============================================================================

alter table public.atendimentos
  add column if not exists id_funcionario_iniciou_fechamento uuid references public.funcionarios(id);

-- -----------------------------------------------------------------------------
-- iniciar_fechamento_atendimento: same 1-arg signature as 20260822_001. Only
-- addition is populating the new id_funcionario_iniciou_fechamento audit
-- column (always v_ctx.id_funcionario here, since this RPC only ever
-- matches the caller's own row) — everything else, including the periodic-
-- checklist-decision logic, is byte-for-byte unchanged.
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
  set status = 'finalizando',
      finalizando_em = now(),
      id_funcionario_iniciou_fechamento = v_ctx.id_funcionario
  where id = v_atendimento.id;

  return true;
end;
$$;

revoke all on function public.iniciar_fechamento_atendimento(text) from public;
grant execute on function public.iniciar_fechamento_atendimento(text) to anon;

-- -----------------------------------------------------------------------------
-- voltar_ao_atendimento: same 1-arg signature as 20260822_001. Only addition
-- is nulling id_funcionario_iniciou_fechamento alongside finalizando_em —
-- both represent "this closing episode"; re-entering finalizando later (by
-- anyone) starts a fresh one. Everything else unchanged.
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
      finalizando_em = null,
      id_funcionario_iniciou_fechamento = null
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
-- iniciar_fechamento_atendimento_gerencial — NEW. Performs the
-- em_atendimento -> finalizando takeover on behalf of another employee. See
-- header note above for the full design rationale.
--
-- Authorization: v_ctx.cargo not in ('Administrador', 'Gerente') — same
-- gate as concluir_atendimento_gerencial (38d7495) and
-- remover_funcionario_lista_da_vez.
--
-- Target resolution: explicit p_id_atendimento, locked with `for update`
-- and matched against status = 'ativo'. transicionar_atendimento_pendente
-- is called first (against the target's own id_funcionario, resolved via a
-- preliminary lookup) — closes the same day-boundary race
-- concluir_atendimento_gerencial already guards against.
--
-- The periodic-checklist-verification decision (Milestone 2C.3) is
-- evaluated against the RESPONSIBLE EMPLOYEE's own history
-- (v_atendimento.id_funcionario) — never the acting manager's — since it is
-- the salesperson's own periodic-sampling cadence being tracked, byte-for-
-- byte the same logic as iniciar_fechamento_atendimento with v_ctx swapped
-- for v_atendimento.id_funcionario in that one history query.
-- -----------------------------------------------------------------------------
create or replace function public.iniciar_fechamento_atendimento_gerencial(
  p_session_token text,
  p_id_atendimento uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_id_alvo uuid;
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

  if v_ctx.cargo not in ('Administrador', 'Gerente') then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CONCLUIR_GERENCIAL';
  end if;

  select id_funcionario into v_id_alvo
  from public.atendimentos
  where id = p_id_atendimento;

  if v_id_alvo is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  perform public.transicionar_atendimento_pendente(v_id_alvo);

  select * into v_atendimento
  from public.atendimentos
  where id = p_id_atendimento and status = 'ativo'
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
        where a2.id_funcionario = v_atendimento.id_funcionario
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
  set status = 'finalizando',
      finalizando_em = now(),
      id_funcionario_iniciou_fechamento = v_ctx.id_funcionario
  where id = v_atendimento.id;

  return true;
end;
$$;

revoke all on function public.iniciar_fechamento_atendimento_gerencial(text, uuid) from public;
grant execute on function public.iniciar_fechamento_atendimento_gerencial(text, uuid) to anon;

commit;
