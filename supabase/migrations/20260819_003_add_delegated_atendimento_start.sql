begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2A.1: Start Atendimento on Behalf of
-- Another Employee
--
-- Depends on 20260819_001_add_atendimento_fechamento_clientes_motivos.sql and
-- 20260819_002_revise_finalizando_duration_rule_and_motive_labels.sql. Those
-- and every earlier migration are treated as immutable applied history and
-- are not modified here.
--
-- Scope (docs/portal-benvisi-blueprint.md section 5.4 "Responsible Employee
-- vs Authenticated Actor", 8.6.1, 8.6.2, ADR-019, ADR-020): an authenticated
-- employee may start an Atendimento for another employee ("responsible
-- employee") who is currently available in Lista da Vez, without
-- impersonation or session switching. The Atendimento is attributed to the
-- responsible employee; the authenticated actor who performed the delegated
-- start is preserved for auditability but gains no ongoing control over the
-- Atendimento beyond a narrow 60-second accidental-start undo permission
-- (vs. the normal 20-second self-start window).
--
-- id_funcionario on atendimentos remains "the responsible employee" — its
-- meaning and every existing invariant/index built on it (one active
-- Atendimento per employee, queue repositioning, etc.) are completely
-- unchanged. id_funcionario_iniciador is new: "who actually performed the
-- system action". For every self-start, id_funcionario_iniciador equals
-- id_funcionario — there is no behavioral difference from Milestone 2A
-- unless a delegated start is explicitly requested.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- id_funcionario_iniciador: added nullable, backfilled, then set NOT NULL.
-- Historical rows (all of them, since delegated start did not exist before
-- this migration) are backfilled to id_funcionario_iniciador = id_funcionario
-- — self-start was the only supported behavior at the time, so the
-- responsible employee is also, correctly, the historical initiating actor.
-- This is a documented assumption, not an invented fact: it is true by
-- construction for every row that exists before this migration runs.
-- -----------------------------------------------------------------------------
alter table public.atendimentos
  add column if not exists id_funcionario_iniciador uuid references public.funcionarios(id);

update public.atendimentos
set id_funcionario_iniciador = id_funcionario
where id_funcionario_iniciador is null;

alter table public.atendimentos
  alter column id_funcionario_iniciador set not null;

-- -----------------------------------------------------------------------------
-- id_funcionario_cancelou: who actually performed a
-- cancelar_atendimento_provisorio cancellation — the responsible employee in
-- the ordinary case, or the delegating initiator when they used their
-- narrow undo permission (section 5). Nullable: most Atendimentos are never
-- cancelled.
-- -----------------------------------------------------------------------------
alter table public.atendimentos
  add column if not exists id_funcionario_cancelou uuid references public.funcionarios(id);

-- -----------------------------------------------------------------------------
-- iniciar_atendimento: extended with an optional p_id_funcionario_alvo.
-- Omitted (or equal to the caller) — identical self-start behavior to
-- Milestone 1/2A, byte-for-byte the same queue/eligibility logic. Provided
-- and different from the caller — a delegated start: v_id_alvo (not the
-- caller) is who must have completed Iniciar Atividades, who must be
-- currently available, whose queue-order/out-of-turn status is evaluated,
-- and for whom the Atendimento row and queue update are created — the
-- caller's own lista_vez_fila row is never read or written anywhere in this
-- function, so "authenticated actor's own queue state stays unchanged" is
-- true simply because the code was never touching any row but the target's
-- to begin with.
--
-- The accidental-start grace period is 20 seconds for a self-start and 60
-- seconds for a delegated start (id_funcionario_iniciador <> id_funcionario),
-- computed once here and returned as prazo_provisorio_em — the same
-- authoritative-deadline architecture as Milestone 1 (ADR-007/008), just
-- with a duration that depends on whether this specific Atendimento was
-- delegated.
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

  if exists (
    select 1 from public.atendimentos
    where id_funcionario = v_id_alvo and status in ('ativo', 'finalizando')
  ) then
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

-- The old 2-arg overload (p_session_token, p_confirmar_fora_de_ordem) from
-- 20260818_001 is superseded by the 3-arg version above (its third
-- parameter has a default, so every existing call site — which always
-- passes exactly 2 named arguments — resolves to this same function without
-- any frontend change). Drop the now-redundant 2-arg overload explicitly so
-- exactly one iniciar_atendimento exists; leaving both would mean any call
-- site that ever passes positional args could silently resolve to the
-- wrong overload.
drop function if exists public.iniciar_atendimento(text, boolean);

-- -----------------------------------------------------------------------------
-- get_atendimento_ativo: prazo_provisorio_em now uses the same dynamic
-- 20s/60s grace period as iniciar_atendimento (based on whether this
-- Atendimento was delegated), so a responsible employee's own active card
-- shows the correct countdown/cancel-availability window regardless of who
-- started it. iniciado_por_nome is new — null for a self-start, otherwise
-- the initiator's display name, so the responsible employee can see at a
-- glance that someone else started this for them (section 6/10
-- transparency). Requires DROP + CREATE — new output column.
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
  iniciado_por_nome text
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
      case when a.id_funcionario_iniciador <> a.id_funcionario then fi.nome::text else null end
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
-- get_lista_vez_estado: three new columns, populated only for
-- 'em_atendimento' rows (status = 'ativo') — exactly where
-- cancelar_atendimento_provisorio's narrow initiator-cancel permission can
-- ever apply. id_atendimento and prazo_provisorio_em give the client enough
-- to render and act on that permission from Lista da Vez itself, without a
-- second round trip; id_funcionario_iniciador lets the client compare
-- against its own session identity to decide whether to show that action at
-- all — the identity check is advisory/UX only, since
-- cancelar_atendimento_provisorio independently re-validates permission
-- server-side regardless of what the client shows. 'finalizando' and
-- 'disponivel' rows keep all three null, consistent with iniciado_em's
-- existing null-while-finalizando treatment (no client-side inference is
-- possible from data that was never sent). Requires DROP + CREATE — new
-- output columns.
-- -----------------------------------------------------------------------------
drop function if exists public.get_lista_vez_estado(text);

create function public.get_lista_vez_estado(
  p_session_token text
)
returns table (
  id_funcionario uuid,
  nome text,
  status text,
  ordem int,
  iniciado_em timestamptz,
  id_atendimento uuid,
  id_funcionario_iniciador uuid,
  prazo_provisorio_em timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ctx record;
  v_dia date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  return query
    select
      f.id_funcionario,
      fu.nome::text,
      case
        when f.disponivel then 'disponivel'
        when a.status = 'finalizando' then 'finalizando'
        else 'em_atendimento'
      end as status,
      case
        when f.disponivel then
          row_number() over (partition by f.disponivel order by f.posicao asc)::int
        else null
      end as ordem,
      case when a.status = 'ativo' then a.iniciado_em else null end as iniciado_em,
      case when a.status = 'ativo' then a.id else null end as id_atendimento,
      case when a.status = 'ativo' then a.id_funcionario_iniciador else null end
        as id_funcionario_iniciador,
      case
        when a.status = 'ativo' then
          a.iniciado_em + make_interval(
            secs => case when a.id_funcionario_iniciador <> a.id_funcionario then 60 else 20 end
          )
        else null
      end as prazo_provisorio_em
    from public.lista_vez_fila f
    join public.funcionarios fu on fu.id = f.id_funcionario
    left join public.atendimentos a
      on a.id_funcionario = f.id_funcionario and a.status in ('ativo', 'finalizando')
    where f.dia_manaus = v_dia
    order by f.disponivel desc, f.posicao asc;
end;
$$;

revoke all on function public.get_lista_vez_estado(text) from public;
grant execute on function public.get_lista_vez_estado(text) to anon;

-- -----------------------------------------------------------------------------
-- cancelar_atendimento_provisorio: now identifies the target Atendimento by
-- explicit p_id_atendimento rather than implicitly resolving "the caller's
-- own active Atendimento". This is a necessary correctness fix, not a
-- stylistic change: once a single employee can simultaneously be the
-- responsible employee of their own Atendimento AND the initiator of
-- delegated Atendimentos for other employees, "my own active Atendimento"
-- is no longer unambiguous — a caller could legitimately be linked to
-- several simultaneously-active rows in different roles. An explicit id
-- removes the ambiguity entirely; get_atendimento_ativo already returns
-- `id` for the self-cancel case, and get_lista_vez_estado now returns
-- id_atendimento for the delegated-initiator case, so both call sites can
-- supply it without a second lookup.
--
-- Permission (section 5): allowed for the responsible employee (always,
-- exactly as before) OR the delegating initiator (only within that
-- Atendimento's own grace period — 60s since it's delegated by definition
-- whenever the initiator differs from the responsible employee). Not the
-- caller at all -> SEM_PERMISSAO_CANCELAR, a distinct error from "no such
-- provisional Atendimento" (NENHUM_ATENDIMENTO_ATIVO) so the two failure
-- modes stay distinguishable if ever surfaced differently later. The grace
-- deadline is still computed and enforced entirely server-side from
-- iniciado_em, exactly as before — no client-supplied timestamp is ever
-- trusted, and 20s self-starts are completely unaffected.
--
-- Uses CREATE OR REPLACE (not a bare CREATE) so this migration stays safely
-- re-runnable, same reasoning as concluir_atendimento's 1-arg -> 2-arg
-- evolution in 20260819_001: the old 1-arg signature genuinely differs from
-- this 2-arg one, so on a second application the DROP IF EXISTS above is a
-- no-op (the 1-arg version is already gone) and a bare CREATE would then
-- collide with the 2-arg version this same migration already created,
-- failing with "already exists with same argument types". OR REPLACE
-- updates it in place instead.
-- -----------------------------------------------------------------------------
drop function if exists public.cancelar_atendimento_provisorio(text);

create or replace function public.cancelar_atendimento_provisorio(
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
  v_atendimento record;
  v_dia date;
  v_grace_seconds int;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  select * into v_atendimento
  from public.atendimentos
  where id = p_id_atendimento and status = 'ativo'
  for update;

  if v_atendimento.id is null then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  if v_atendimento.id_funcionario <> v_ctx.id_funcionario
     and v_atendimento.id_funcionario_iniciador <> v_ctx.id_funcionario then
    raise exception using errcode = 'P0001', message = 'SEM_PERMISSAO_CANCELAR';
  end if;

  v_grace_seconds := case
    when v_atendimento.id_funcionario_iniciador <> v_atendimento.id_funcionario then 60
    else 20
  end;

  if now() > v_atendimento.iniciado_em + make_interval(secs => v_grace_seconds) then
    raise exception using errcode = 'P0001', message = 'PRAZO_PROVISORIO_EXPIRADO';
  end if;

  v_dia := (v_atendimento.iniciado_em at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'cancelado', cancelado_em = now(), id_funcionario_cancelou = v_ctx.id_funcionario
  where id = v_atendimento.id;

  update public.lista_vez_fila
  set disponivel = true, atualizado_em = now()
  where id_funcionario = v_atendimento.id_funcionario and dia_manaus = v_dia;

  return true;
end;
$$;

revoke all on function public.cancelar_atendimento_provisorio(text, uuid) from public;
grant execute on function public.cancelar_atendimento_provisorio(text, uuid) to anon;

commit;
