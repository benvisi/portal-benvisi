begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 2A: Real Closing Flow + Customer Outcomes +
-- Motives
--
-- Depends on 20260818_001_add_atendimento_lista_vez.sql and
-- 20260818_002_add_iniciado_em_to_lista_vez_estado.sql — apply those first.
-- Per instruction, those two files are treated as immutable history and are
-- not modified here; every change below is additive/forward.
--
-- Scope (docs/portal-benvisi-blueprint.md section 8, Milestone 2A product
-- clarifications): Milestone 1's Concluir atendimento no longer completes an
-- Atendimento immediately. It now enters a "finalizando" (closing) state in
-- which the employee records one or more customer outcomes (Convertido /
-- Não convertido, each with a data-driven motive and — for some motives —
-- a required detail) before a real final-submission RPC completes the
-- Atendimento. Voltar ao atendimento abandons closing and returns to the
-- normal active state without completing or losing queue position. The
-- reset checklist (Milestone 2B) is explicitly out of scope here.
--
-- This migration follows the same idempotent/self-verifying, fail-loud
-- conventions established in 20260818_001 (guarded constraint/index
-- creation with duplicate/violation preflights) so it is safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- atendimentos: add finalizando_em and widen status to include 'finalizando'.
--
-- Status lifecycle is now: ativo -> finalizando -> concluido (normal path);
-- finalizando -> ativo (Voltar ao atendimento — finalizando_em cleared,
-- iniciado_em untouched so the 20-second-deadline and elapsed-duration
-- calculations are unaffected); ativo -> cancelado (unchanged, only within
-- the 20-second window, only ever reachable from 'ativo').
--
-- finalizando_em is the "moment the employee entered closing" the prompt
-- asks the database to preserve, distinct from iniciado_em (customer-facing
-- start) and concluido_em (final completion).
--
-- tempo_finalizando_acumulado is the running total of every past
-- ativo -> finalizando -> ativo (or -> concluido) cycle's duration, added to
-- exactly once per cycle at the moment that cycle ends (see
-- voltar_ao_atendimento and concluir_atendimento below). iniciado_em itself
-- is NEVER modified by entering/leaving finalizando — it remains the true
-- original start, so the 20-second accidental-start deadline (always
-- iniciado_em + 20s) can never be reopened or shifted by a Voltar ao
-- atendimento. Customer-facing elapsed duration at any moment is instead
-- computed as (reference_time - iniciado_em - tempo_finalizando_acumulado),
-- where reference_time is now() while 'ativo', finalizando_em while
-- 'finalizando' (frozen — the current, not-yet-accumulated finalizando
-- period is excluded), or concluido_em once 'concluido'. This is fully
-- server-authoritative and durable: it survives refresh/navigation because
-- it lives in this column, not in any client-side timer state.
-- -----------------------------------------------------------------------------
alter table public.atendimentos
  add column if not exists finalizando_em timestamptz;

alter table public.atendimentos
  add column if not exists tempo_finalizando_acumulado interval not null default '0 seconds'::interval;

-- Guarded: widen the status enum check to include 'finalizando'. Detected by
-- pattern (does an existing check constraint already mention
-- 'finalizando'?) so this is safe to re-run.
do $$
declare
  v_already_protected boolean;
  v_violation_count int;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.atendimentos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%ativo%'
      and pg_get_constraintdef(oid) ilike '%finalizando%'
      and pg_get_constraintdef(oid) ilike '%concluido%'
      and pg_get_constraintdef(oid) ilike '%cancelado%'
  ) into v_already_protected;

  if not v_already_protected then
    select count(*) into v_violation_count
    from public.atendimentos
    where status not in ('ativo', 'finalizando', 'concluido', 'cancelado');

    if v_violation_count > 0 then
      raise exception
        'public.atendimentos has % row(s) with a status value outside the '
        'expected set. Resolve manually before this migration can widen '
        'the status check. Diagnostic query: select distinct status from '
        'public.atendimentos;',
        v_violation_count;
    end if;

    alter table public.atendimentos drop constraint if exists atendimentos_status_check;

    alter table public.atendimentos
      add constraint atendimentos_status_check
      check (status in ('ativo', 'finalizando', 'concluido', 'cancelado'));
  end if;
end $$;

-- Guarded: widen the status/timestamp consistency check to account for
-- finalizando_em and the new 'finalizando' status. 'concluido' intentionally
-- does not require finalizando_em to be non-null here — Milestone 1 rows
-- completed instantly (no closing flow existed yet) and remain valid
-- historical 'concluido' rows; only 'finalizando' and 'ativo' constrain
-- finalizando_em's nullability going forward.
do $$
declare
  v_already_protected boolean;
  v_violation_count int;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.atendimentos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%finalizando_em%'
      and pg_get_constraintdef(oid) ilike '%concluido_em%'
      and pg_get_constraintdef(oid) ilike '%cancelado_em%'
  ) into v_already_protected;

  if not v_already_protected then
    select count(*) into v_violation_count
    from public.atendimentos
    where not (
      (status = 'ativo' and finalizando_em is null and concluido_em is null and cancelado_em is null)
      or (status = 'finalizando' and finalizando_em is not null and concluido_em is null and cancelado_em is null)
      or (status = 'concluido' and concluido_em is not null and cancelado_em is null)
      or (status = 'cancelado' and cancelado_em is not null and concluido_em is null and finalizando_em is null)
    );

    if v_violation_count > 0 then
      raise exception
        'public.atendimentos has % row(s) whose status/timestamp '
        'combination would violate the widened '
        'atendimentos_status_timestamps_consistentes check. Resolve '
        'manually before this migration can add it.',
        v_violation_count;
    end if;

    alter table public.atendimentos
      drop constraint if exists atendimentos_status_timestamps_consistentes;

    alter table public.atendimentos
      add constraint atendimentos_status_timestamps_consistentes check (
        (status = 'ativo' and finalizando_em is null and concluido_em is null and cancelado_em is null)
        or (status = 'finalizando' and finalizando_em is not null and concluido_em is null and cancelado_em is null)
        or (status = 'concluido' and concluido_em is not null and cancelado_em is null)
        or (status = 'cancelado' and cancelado_em is not null and concluido_em is null and finalizando_em is null)
      );
  end if;
end $$;

-- Guarded: the "one active Atendimento per employee" DB-level invariant
-- (section 15.2) must now cover BOTH 'ativo' and 'finalizando' — an
-- Atendimento in the closing flow is still the employee's one active
-- session and must keep blocking a second iniciar_atendimento call. The old
-- 20260818_001 index only covered status = 'ativo'; replace it with one
-- covering status in ('ativo', 'finalizando').
do $$
declare
  v_already_protected boolean;
  v_duplicate_count int;
begin
  select exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.atendimentos'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%id_funcionario%'
      and pg_get_indexdef(i.indexrelid) ilike '%where%'
      and pg_get_indexdef(i.indexrelid) ilike '%ativo%'
      and pg_get_indexdef(i.indexrelid) ilike '%finalizando%'
  ) into v_already_protected;

  if not v_already_protected then
    select count(*) into v_duplicate_count
    from (
      select id_funcionario
      from public.atendimentos
      where status in ('ativo', 'finalizando')
      group by id_funcionario
      having count(*) > 1
    ) dupes;

    if v_duplicate_count > 0 then
      raise exception
        'public.atendimentos has % employee(s) with more than one row in '
        '(''ativo'', ''finalizando''). Resolve these manually before this '
        'migration can enforce one active Atendimento per employee. '
        'Diagnostic query: select id_funcionario, count(*) from '
        'public.atendimentos where status in (''ativo'', ''finalizando'') '
        'group by 1 having count(*) > 1;',
        v_duplicate_count;
    end if;

    drop index if exists public.atendimentos_um_ativo_por_funcionario_idx;

    create unique index atendimentos_um_ativo_por_funcionario_idx
      on public.atendimentos (id_funcionario)
      where status in ('ativo', 'finalizando');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- atendimento_motivos: data-driven motive catalog (section 8 "Motive Data
-- Model"). Seeded below with the exact Production V1 motive lists — no
-- motive-editor UI in this milestone, so this table is only ever modified by
-- migrations.
-- -----------------------------------------------------------------------------
create table if not exists public.atendimento_motivos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  categoria text not null check (categoria in ('convertido', 'nao_convertido')),
  rotulo text not null,
  detalhe_obrigatorio boolean not null default false,
  ativo boolean not null default true,
  ordem_exibicao int not null,
  criado_em timestamptz not null default now()
);

create index if not exists atendimento_motivos_categoria_ativo_ordem_idx
  on public.atendimento_motivos (categoria, ativo, ordem_exibicao);

alter table public.atendimento_motivos enable row level security;
-- No policies: read access is via list_atendimento_motivos below (per
-- CLAUDE.md "prefer RPCs over exposing tables directly"), matching the
-- SECURITY DEFINER convention used by every other table in this project —
-- not a special case for being "just reference data".

-- Idempotent seed (ON CONFLICT on the unique codigo). Exact motive sets
-- from the Product Owner's Production V1 lists — do not add to these
-- without an explicit product decision (see section 8.6/8.7 of the
-- Milestone 2A prompt).
insert into public.atendimento_motivos (codigo, categoria, rotulo, detalhe_obrigatorio, ordem_exibicao)
values
  ('compra_pessoal', 'convertido', 'Compra pessoal', false, 1),
  ('compra_presente', 'convertido', 'Compra para presente', false, 2),
  ('troca_convertido', 'convertido', 'Troca', false, 3),
  ('outro_convertido', 'convertido', 'Outro', true, 4),

  ('so_olhando', 'nao_convertido', 'Só olhando', false, 1),
  ('preco', 'nao_convertido', 'Preço', false, 2),
  ('nao_gostou_opcoes', 'nao_convertido', 'Não gostou das opções', false, 3),
  ('produto_indisponivel', 'nao_convertido', 'Produto ou tamanho indisponível', true, 4),
  ('troca_sem_compra', 'nao_convertido', 'Troca sem nova compra', false, 5),
  ('outro_nao_convertido', 'nao_convertido', 'Outro', true, 6)
on conflict (codigo) do nothing;

-- -----------------------------------------------------------------------------
-- atendimento_clientes: one row per recorded customer outcome, many-to-one
-- with atendimentos (section 9 "Customer Outcome Persistence" — explicitly
-- not flattened into the atendimentos row). No customer identity is
-- collected (no name/CPF/phone/email/CRM id), by design.
--
-- categoria and motivo_rotulo are snapshotted from atendimento_motivos at
-- insert time, in addition to the id_motivo foreign key: if a motive is
-- later renamed or deactivated, this row still shows exactly what the
-- employee selected and what it meant at the time, per "Historical customer
-- records must remain interpretable if motives are later renamed or
-- deactivated." id_motivo is kept for traceability/joins to current motive
-- config; motives are only ever deactivated, never deleted, so this FK
-- never needs ON DELETE CASCADE/SET NULL handling.
-- -----------------------------------------------------------------------------
create table if not exists public.atendimento_clientes (
  id uuid primary key default gen_random_uuid(),
  id_atendimento uuid not null references public.atendimentos(id) on delete cascade,
  id_motivo uuid not null references public.atendimento_motivos(id),
  categoria text not null check (categoria in ('convertido', 'nao_convertido')),
  motivo_rotulo text not null,
  detalhe text,
  criado_em timestamptz not null default now()
);

create index if not exists atendimento_clientes_id_atendimento_idx
  on public.atendimento_clientes (id_atendimento);

create index if not exists atendimento_clientes_categoria_idx
  on public.atendimento_clientes (categoria);

alter table public.atendimento_clientes enable row level security;
-- No policies: written exclusively by concluir_atendimento (SECURITY
-- DEFINER) below, same convention as every other table in this project.

-- -----------------------------------------------------------------------------
-- list_atendimento_motivos: read-only, active motives only, ordered for
-- direct UI consumption.
-- -----------------------------------------------------------------------------
create or replace function public.list_atendimento_motivos(
  p_session_token text
)
returns table (
  id uuid,
  codigo text,
  categoria text,
  rotulo text,
  detalhe_obrigatorio boolean,
  ordem_exibicao int
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
    select m.id, m.codigo, m.categoria, m.rotulo, m.detalhe_obrigatorio, m.ordem_exibicao
    from public.atendimento_motivos m
    where m.ativo = true
    order by m.categoria, m.ordem_exibicao;
end;
$$;

revoke all on function public.list_atendimento_motivos(text) from public;
grant execute on function public.list_atendimento_motivos(text) to anon;

-- -----------------------------------------------------------------------------
-- iniciar_fechamento_atendimento: Concluir atendimento's new behavior — ends
-- the customer-facing Atendimento duration (iniciado_em is left untouched;
-- "ended" here means the employee's own card and every other viewer's Lista
-- da Vez row stop showing it as an increasing timer, achieved by the status
-- transition below plus get_lista_vez_estado/get_atendimento_ativo changes
-- further down) and enters the closing flow. Queue membership is
-- untouched — the employee is already disponivel = false from when the
-- Atendimento began, and stays that way through finalizando.
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
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  update public.atendimentos
  set status = 'finalizando', finalizando_em = now()
  where id_funcionario = v_ctx.id_funcionario and status = 'ativo';

  if not found then
    raise exception using errcode = 'P0001', message = 'NENHUM_ATENDIMENTO_ATIVO';
  end if;

  return true;
end;
$$;

revoke all on function public.iniciar_fechamento_atendimento(text) from public;
grant execute on function public.iniciar_fechamento_atendimento(text) to anon;

-- -----------------------------------------------------------------------------
-- voltar_ao_atendimento: abandon the closing flow (section 2 of the
-- Milestone 2A prompt). Symmetric to iniciar_fechamento_atendimento —
-- clears finalizando_em, returns to 'ativo'. iniciado_em is never touched,
-- so the 20-second-deadline math resumes exactly where it would have been
-- had closing never been entered — Voltar ao atendimento cannot reopen or
-- shift that deadline. The just-ended finalizando period's duration (now()
-- minus the finalizando_em that is about to be cleared) is added to
-- tempo_finalizando_acumulado in the same statement, so the customer-facing
-- elapsed duration correctly excludes it going forward, across any number
-- of ativo -> finalizando -> ativo cycles. No customer data exists
-- server-side to discard (the closing form's draft entries only ever live
-- in the client, per section 13 of the prompt), and lista_vez_fila is
-- untouched, so queue position/order cannot change.
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

  update public.atendimentos
  set status = 'ativo',
      tempo_finalizando_acumulado = tempo_finalizando_acumulado + (now() - finalizando_em),
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
-- concluir_atendimento: REPLACES Milestone 1's instant-completion RPC of
-- the same name. The old public.concluir_atendimento(text) is dropped
-- outright (not left alongside the new signature) — leaving it in place
-- would be a live bypass of the entire closing flow, since Postgres
-- overloads functions by full signature and CREATE OR REPLACE cannot
-- convert a 1-arg function into a 2-arg one in place.
--
-- p_clientes is a JSON array of { "id_motivo": "<uuid>", "detalhe":
-- "<text or null>" }. The client never asserts categoria — this function
-- derives it authoritatively from atendimento_motivos, per "Do not trust
-- client assertions about whether a motive belongs to
-- converted/non-converted, whether a motive requires detail, or whether
-- the Atendimento can be completed."
--
-- No id_atendimento parameter exists at all: the target Atendimento is
-- always resolved as "this session's employee's row currently in
-- 'finalizando'", which is simultaneously how ownership is enforced (there
-- is no id to substitute someone else's Atendimento into) and how the
-- closing-state precondition is enforced.
--
-- `for update` on the atendimentos row, combined with the status = 'ativo'
-- from the closing flow, atomically guards against duplicate submissions:
-- a second concurrent call blocks on the row lock, then — once the first
-- call commits — re-evaluates `status = 'finalizando'`, which no longer
-- matches (it is now 'concluido'), so it cleanly fails with
-- ATENDIMENTO_NAO_ESTA_FINALIZANDO instead of creating duplicate customer
-- rows, double-completing, or double-returning the employee to the queue.
--
-- Every customer entry is validated (motive exists, is active, and — if it
-- requires detail — that detail is present) inside one loop, each
-- validated entry inserted immediately after. Because the whole function
-- body executes inside the one transaction wrapping this RPC call, an
-- exception raised on any entry — including the very last one — rolls back
-- every insert already performed by this same call. No partial customer
-- records can survive a failed submission.
-- -----------------------------------------------------------------------------
-- Old 1-arg signature dropped explicitly (see header comment); the new
-- 2-arg signature below uses CREATE OR REPLACE rather than a bare CREATE so
-- this whole migration stays safely re-runnable — on a second application,
-- the DROP IF EXISTS above is a no-op (the 1-arg version is already gone)
-- and OR REPLACE updates the 2-arg version in place instead of erroring
-- with "function already exists".
drop function if exists public.concluir_atendimento(text);

create or replace function public.concluir_atendimento(
  p_session_token text,
  p_clientes jsonb
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

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  -- The final (successful) finalizando period is accumulated here too, the
  -- same way voltar_ao_atendimento accumulates an abandoned one — so
  -- concluido_em - iniciado_em - tempo_finalizando_acumulado gives the true
  -- customer-facing duration for every completed Atendimento, regardless of
  -- how many closing attempts preceded it, for accurate historical
  -- reporting later.
  update public.atendimentos
  set status = 'concluido',
      concluido_em = now(),
      tempo_finalizando_acumulado = tempo_finalizando_acumulado + (now() - finalizando_em)
  where id = v_atendimento.id;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus, disponivel, posicao)
  values (v_ctx.id_funcionario, v_dia, true, nextval('public.lista_vez_posicao_seq'))
  on conflict (id_funcionario, dia_manaus)
  do update set
    disponivel = true,
    posicao = excluded.posicao,
    atualizado_em = now();

  return true;
end;
$$;

revoke all on function public.concluir_atendimento(text, jsonb) from public;
grant execute on function public.concluir_atendimento(text, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- get_atendimento_ativo: now also matches 'finalizando' (not only 'ativo')
-- and returns status, so the client can render the closing form on
-- resume/refresh instead of only ever seeing the active card. Requires
-- DROP + CREATE — adding an output column changes the return type, which
-- CREATE OR REPLACE cannot do (same reasoning as verify_pin in
-- 20260722_001 and get_lista_vez_estado in 20260818_002).
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
  prazo_provisorio_em timestamptz
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
      a.iniciado_em + interval '20 seconds'
    from public.atendimentos a
    where a.id_funcionario = v_ctx.id_funcionario
      and a.status in ('ativo', 'finalizando')
    limit 1;
end;
$$;

revoke all on function public.get_atendimento_ativo(text) from public;
grant execute on function public.get_atendimento_ativo(text) to anon;

-- -----------------------------------------------------------------------------
-- iniciar_atendimento: the existing-active-Atendimento guard must now also
-- block starting a new Atendimento while one is 'finalizando', not only
-- 'ativo' — otherwise an employee mid-closing could start a second
-- Atendimento, which the widened partial unique index above would also
-- reject, but with a raw unique_violation instead of a clean error. No
-- other logic in this function changes.
-- -----------------------------------------------------------------------------
create or replace function public.iniciar_atendimento(
  p_session_token text,
  p_confirmar_fora_de_ordem boolean default false
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
  v_primeiro_id uuid;
  v_fora_de_ordem boolean;
  v_atendimento record;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  v_dia := (now() at time zone 'America/Manaus')::date;

  if not exists (
    select 1
    from public.turno_presenca
    where id_funcionario = v_ctx.id_funcionario
      and (checked_in_at at time zone 'America/Manaus')::date = v_dia
  ) then
    raise exception using errcode = 'P0001', message = 'ATIVIDADES_NAO_INICIADAS';
  end if;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  select id_funcionario into v_primeiro_id
  from public.lista_vez_fila
  where dia_manaus = v_dia and disponivel = true
  order by posicao asc
  limit 1;

  v_fora_de_ordem := (v_primeiro_id is distinct from v_ctx.id_funcionario);

  if v_fora_de_ordem and not p_confirmar_fora_de_ordem then
    raise exception using errcode = 'P0001', message = 'CONFIRMACAO_FORA_DE_ORDEM_NECESSARIA';
  end if;

  if exists (
    select 1 from public.atendimentos
    where id_funcionario = v_ctx.id_funcionario and status in ('ativo', 'finalizando')
  ) then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end if;

  update public.lista_vez_fila
  set disponivel = false, atualizado_em = now()
  where id_funcionario = v_ctx.id_funcionario and dia_manaus = v_dia;

  begin
    insert into public.atendimentos (id_funcionario, fora_de_ordem)
    values (v_ctx.id_funcionario, v_fora_de_ordem)
    returning atendimentos.id, atendimentos.iniciado_em, atendimentos.fora_de_ordem
    into v_atendimento;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ATENDIMENTO_ATIVO_EXISTENTE';
  end;

  return query select
    v_atendimento.id,
    v_atendimento.iniciado_em,
    v_atendimento.fora_de_ordem,
    v_atendimento.iniciado_em + interval '20 seconds';
end;
$$;

revoke all on function public.iniciar_atendimento(text, boolean) from public;
grant execute on function public.iniciar_atendimento(text, boolean) to anon;

-- -----------------------------------------------------------------------------
-- get_lista_vez_estado: em_atendimento boolean replaced with a three-state
-- status ('disponivel' | 'em_atendimento' | 'finalizando') so Lista da Vez
-- can show "Finalizando" instead of a ticking timer for an employee in the
-- closing flow. iniciado_em is only ever populated for 'em_atendimento' —
-- explicitly null for 'finalizando' (and 'disponivel'), so the client
-- cannot accidentally render an increasing timer for a closing-flow
-- employee even if it tried; the server, not just frontend discipline,
-- enforces "no increasing timer while finalizando". ordem/consecutive
-- numbering logic is unchanged (still driven only by lista_vez_fila.
-- disponivel, which finalizando does not alter), preserving Milestone 1's
-- consecutive queue-numbering behavior exactly. Requires DROP + CREATE —
-- same return-type-change reasoning as above.
--
-- The 'em_atendimento' iniciado_em value returned here is
-- iniciado_em + tempo_finalizando_acumulado, not the raw start timestamp:
-- shifting the anchor forward by the total time already excluded lets the
-- existing client-side "now() - iniciado_em" elapsed-minutes calculation
-- (useElapsedMinutes, unchanged) keep working exactly as before while
-- correctly excluding all past finalizando cycles, with no frontend
-- changes required. This is unrelated to (and does not affect)
-- get_atendimento_ativo's prazo_provisorio_em, which continues to use the
-- unshifted, raw iniciado_em for the 20-second deadline.
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
  iniciado_em timestamptz
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
      case
        when a.status = 'ativo' then a.iniciado_em + a.tempo_finalizando_acumulado
        else null
      end as iniciado_em
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

commit;
