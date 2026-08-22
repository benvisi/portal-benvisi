begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2C.3: Verificação Periódica do Checklist
--
-- Adds a third checklist_config.policy value, `periodic_verification`
-- (employee/admin-facing label "Verificação periódica"), alongside the
-- existing `required` and `defer_allowed`. Under this policy, each eligible
-- Atendimento's checklist becomes mandatory or optional via a small
-- server-authoritative sampling algorithm — never client-side, never at
-- Atendimento start — evaluated exactly once per Atendimento, at the
-- moment it FIRST enters `Finalizando`, and persisted immutably on that
-- Atendimento from then on.
--
-- Schema: four new nullable columns directly on `atendimentos` —
-- checklist_obrigatorio (the decision itself), checklist_decisao_motivo
-- (why — 'sorteio' | 'gap_maximo' | 'pos_obrigatorio' | 'nao_selecionado'),
-- checklist_decisao_em (when), checklist_politica_no_momento (snapshot of
-- the policy value that was active at decision time — same
-- snapshot-not-live-reference pattern already used by
-- checklist_pendencias.politica_no_momento since 2C.1). All four stay null
-- for any Atendimento that never entered Finalizando under
-- periodic_verification — the vast majority of rows, and every historical
-- row from before this milestone. A 1:1 columns-on-atendimentos model was
-- chosen over a separate table because the relationship is genuinely 1:1
-- and always needed in the same transaction as the Atendimento's own
-- status transition (iniciar_fechamento_atendimento) and later read
-- (concluir_atendimento) — no join, no extra table, per "keep the model
-- simple".
--
-- Algorithm (fully server-side, inside iniciar_fechamento_atendimento,
-- only when checklist_obrigatorio is still null AND the live policy is
-- periodic_verification at that exact moment):
--
--   1. Look at this employee's most recent 3 Atendimentos that were
--      themselves decided under periodic_verification (checklist_
--      politica_no_momento = 'periodic_verification' and
--      checklist_obrigatorio is not null), ordered by
--      checklist_decisao_em desc. Atendimentos decided under a different
--      policy, or never decided at all (cancelled before Finalizando),
--      never appear in this sequence and cannot break or extend it —
--      "eligible" means "was itself evaluated under periodic_verification".
--   2. No-consecutive rule: if the single most recent one was mandatory,
--      this one is forced non-mandatory (reason 'pos_obrigatorio') — the
--      random draw is skipped entirely.
--   3. Otherwise, max-gap rule: if there are already 3 such Atendimentos
--      and all 3 were non-mandatory, this one is forced mandatory (reason
--      'gap_maximo').
--   4. Otherwise, a genuine server-side random draw: random() < 0.20 ->
--      mandatory (reason 'sorteio'), else non-mandatory (reason
--      'nao_selecionado'). Every non-mandatory outcome gets an explicit
--      reason code — never a bare NULL — so every decision this algorithm
--      ever makes is individually explainable later.
--
-- concluir_atendimento's deferral branch now checks the Atendimento's OWN
-- persisted decision first (if one exists, it is authoritative and the
-- live checklist_config value is never consulted for that specific
-- Atendimento) and only falls back to the existing 2C.1 live-policy check
-- when no per-Atendimento decision exists at all — see the comment above
-- that branch below for the full reasoning on why this is the correct,
-- non-arbitrary resolution of "what happens if policy changes after a
-- periodic decision was already made", rather than an invented rule.
--
-- Concurrency: no new lock is introduced. iniciar_fechamento_atendimento
-- already takes `select ... where status = 'ativo' for update` on the
-- specific Atendimento row before this migration's changes, and the
-- existing partial unique index (one active/finalizing Atendimento per
-- employee) makes it structurally impossible for the same employee to have
-- two Atendimentos concurrently transitioning into Finalizando — so the
-- periodic-decision computation is already fully serialized per employee
-- by locks/invariants that predate this migration. A second concurrent
-- iniciar_fechamento_atendimento call for the SAME Atendimento (double
-- click / two devices) blocks on that same row lock, then finds
-- status <> 'ativo' once unblocked and fails cleanly before ever reaching
-- the decision logic — so a decision is still made at most once per
-- Atendimento. The new `checklist_config` read inside
-- iniciar_fechamento_atendimento uses `for share`, for the same reason and
-- in the same lock order (Atendimento row -> checklist_config) already
-- established for concluir_atendimento's deferral branch since 2C.1 — no
-- new deadlock path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- checklist_config.policy / checklist_policy_eventos.politica_nova: widen
-- the allowed-value check constraints to include 'periodic_verification'.
-- Both were originally created as unnamed inline column checks in 2C.1
-- (20260821_002), so this discovers the actual constraint by its
-- definition rather than assuming Postgres's default-generated name,
-- staying safely re-runnable either way.
-- -----------------------------------------------------------------------------
do $$
declare
  v_old_constraint text;
begin
  select conname into v_old_constraint
  from pg_constraint
  where conrelid = 'public.checklist_config'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%policy%'
    and pg_get_constraintdef(oid) not ilike '%periodic_verification%';

  if v_old_constraint is not null then
    execute format('alter table public.checklist_config drop constraint %I', v_old_constraint);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_config'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%periodic_verification%'
  ) then
    alter table public.checklist_config
      add constraint checklist_config_policy_check
      check (policy in ('required', 'defer_allowed', 'periodic_verification'));
  end if;
end $$;

do $$
declare
  v_old_constraint text;
begin
  select conname into v_old_constraint
  from pg_constraint
  where conrelid = 'public.checklist_policy_eventos'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%politica_nova%'
    and pg_get_constraintdef(oid) not ilike '%periodic_verification%';

  if v_old_constraint is not null then
    execute format('alter table public.checklist_policy_eventos drop constraint %I', v_old_constraint);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.checklist_policy_eventos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%politica_nova%'
      and pg_get_constraintdef(oid) ilike '%periodic_verification%'
  ) then
    alter table public.checklist_policy_eventos
      add constraint checklist_policy_eventos_politica_nova_check
      check (politica_nova in ('required', 'defer_allowed', 'periodic_verification'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- atendimentos: per-Atendimento periodic-verification decision, persisted
-- at most once, immutable afterward. All nullable — null means "not
-- decided" (either never reached Finalizando, or reached it under a
-- non-periodic policy).
-- -----------------------------------------------------------------------------
alter table public.atendimentos
  add column if not exists checklist_obrigatorio boolean,
  add column if not exists checklist_decisao_motivo text,
  add column if not exists checklist_decisao_em timestamptz,
  add column if not exists checklist_politica_no_momento text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.atendimentos'::regclass
      and conname = 'atendimentos_checklist_decisao_motivo_check'
  ) then
    alter table public.atendimentos
      add constraint atendimentos_checklist_decisao_motivo_check
      check (
        checklist_decisao_motivo is null
        or checklist_decisao_motivo in ('sorteio', 'gap_maximo', 'pos_obrigatorio', 'nao_selecionado')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.atendimentos'::regclass
      and conname = 'atendimentos_checklist_decisao_consistente'
  ) then
    alter table public.atendimentos
      add constraint atendimentos_checklist_decisao_consistente
      check ((checklist_obrigatorio is null) = (checklist_decisao_em is null));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- set_checklist_policy: same signature/authorization as 2C.1 — only the
-- allowed-value list changes.
-- -----------------------------------------------------------------------------
create or replace function public.set_checklist_policy(
  p_session_token text,
  p_policy text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_politica_atual text;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  if v_ctx.cargo <> 'Administrador' then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_POLITICA';
  end if;

  if p_policy not in ('required', 'defer_allowed', 'periodic_verification') then
    raise exception using errcode = 'P0001', message = 'POLITICA_INVALIDA';
  end if;

  select cc.policy into v_politica_atual from public.checklist_config cc where cc.id = 1 for update;

  if v_politica_atual is distinct from p_policy then
    insert into public.checklist_policy_eventos (politica_anterior, politica_nova, id_funcionario_ator)
    values (v_politica_atual, p_policy, v_ctx.id_funcionario);

    update public.checklist_config
    set policy = p_policy, atualizado_em = now(), atualizado_por = v_ctx.id_funcionario
    where id = 1;
  end if;

  return true;
end;
$$;

revoke all on function public.set_checklist_policy(text, text) from public;
grant execute on function public.set_checklist_policy(text, text) to anon;

-- -----------------------------------------------------------------------------
-- get_atendimento_ativo: new output column checklist_obrigatorio, a direct
-- passthrough of the persisted per-Atendimento decision (null unless one
-- was made). New output column -> DROP + CREATE, same convention as every
-- prior evolution of this function.
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
  checklist_obrigatorio boolean
)
language plpgsql
security definer
set search_path = public
stable
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
      a.id,
      a.status,
      a.iniciado_em,
      a.fora_de_ordem,
      a.iniciado_em + make_interval(
        secs => case when a.id_funcionario_iniciador <> a.id_funcionario then 60 else 20 end
      ),
      case when a.id_funcionario_iniciador <> a.id_funcionario then fi.nome::text else null end,
      a.checklist_obrigatorio
    from public.atendimentos a
    left join public.funcionarios fi on fi.id = a.id_funcionario_iniciador
    where a.id_funcionario = v_ctx.id_funcionario
      and a.status in ('ativo', 'finalizando')
    limit 1;
end;
$$;

revoke all on function public.get_atendimento_ativo(text) from public;
grant execute on function public.get_atendimento_ativo(text) to anon;

-- -----------------------------------------------------------------------------
-- iniciar_fechamento_atendimento: unchanged status/finalizando_em
-- transition, now preceded by the (at most once, per Atendimento) periodic
-- decision. Restructured from a bare UPDATE into SELECT ... FOR UPDATE
-- (needed to read the current decision state and the row id before
-- deciding) followed by the same UPDATE as before.
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
-- concluir_atendimento — same 4-arg signature, unchanged customer/checklist-
-- completion validation and unchanged complete-now branch (completing the
-- checklist fully is always allowed, mandatory or not — matches every
-- prior milestone's "encouraged path always available" principle). Only
-- the deferral branch's policy check changes: an Atendimento's own
-- persisted periodic decision, if one exists, is authoritative for that
-- Atendimento and is never re-derived from the live (and possibly since-
-- changed) checklist_config value. Only when no such decision exists at
-- all does this fall back to the exact 2C.1 live-policy FOR SHARE check.
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
      -- Milestone 2C.3: this specific Atendimento already has a persisted
      -- periodic-verification decision — authoritative for it regardless
      -- of what checklist_config.policy is right now.
      if v_atendimento.checklist_obrigatorio then
        raise exception using errcode = 'P0001', message = 'ADIAMENTO_NAO_PERMITIDO';
      end if;
      -- else: this Atendimento was decided non-mandatory -> deferral is
      -- allowed for it regardless of the live global policy; fall through
      -- to the pending-obligation insert below without reading
      -- checklist_config at all.
    else
      -- No periodic decision exists for this Atendimento (governed by
      -- required/defer_allowed at every Finalizando entry so far) — same
      -- live-policy check as 2C.1/2C.2.
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
    -- Complete-now path — unchanged since 20260821_001/002/003. Always
    -- available regardless of policy or periodic decision.
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

commit;
