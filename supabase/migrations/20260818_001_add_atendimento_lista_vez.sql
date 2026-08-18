begin;

-- =============================================================================
-- Epic 2 — Atendimento, Milestone 1: Atendimento + Lista da Vez foundation
--
-- Depends on public.get_valid_employee_session_context(text) from
-- 20260722_001_add_employee_sessions_and_verify_pin_token.sql and
-- public.turno_presenca + public.registrar_turno_presenca (see
-- 20260722_003_add_turno_presenca_rpcs.sql) — apply those migrations first.
--
-- Scope (see docs/portal-benvisi-blueprint.md section 8 for approved
-- behavior): persistent Lista da Vez queue state, one active Atendimento per
-- employee, simultaneous Atendimentos across employees, the Iniciar
-- Atividades prerequisite, in/out-of-queue-order start detection, the
-- 20-second accidental-start grace period with exact position restoration on
-- cancel, and basic completion that returns the employee to the back of the
-- queue. Customer recording, checklist, non-conversion motives, and
-- previous-day pendente_fechamento handling are explicitly out of scope for
-- this milestone (see docs/portal-benvisi-blueprint.md section 8, "out of
-- scope" list) and are left for a later migration.
--
-- REVISION NOTE (post-review, before this migration was ever successfully
-- applied end to end): browser/DB testing found a public.atendimentos table
-- already present in the target development database while
-- public.lista_vez_fila and all five RPCs below were absent — i.e. some
-- earlier attempt got as far as creating public.atendimentos and no
-- further (most likely the Supabase SQL Editor not treating this file's
-- explicit begin/commit as a single atomic unit the way psql or the
-- Supabase CLI would, so an early DDL statement's effect outlived a later
-- statement's failure in that attempt — the exact mechanism could not be
-- confirmed from here, since this environment has no direct database
-- access; see the diagnostic queries below). Per "do not blindly mask
-- schema incompatibilities", the atendimentos setup below no longer does a
-- bare `create table` — it verifies a pre-existing table's columns,
-- nullability, primary key and foreign key actually match what this
-- migration's RPCs depend on, and refuses to proceed with a specific,
-- actionable error if they don't. Every other statement in this file was
-- already idempotent (`create or replace function`, or now guarded below)
-- and safe to (re)run regardless of how much of a prior attempt succeeded.
--
-- Read-only diagnostics you can run against public.atendimentos before (or
-- instead of) re-applying this migration, if you want to see for yourself
-- what this migration's own verification below will check automatically:
--
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'atendimentos'
--   order by ordinal_position;
--
--   select conname, contype, pg_get_constraintdef(oid) as definition
--   from pg_constraint
--   where conrelid = 'public.atendimentos'::regclass
--   order by conname;
--
--   select indexname, indexdef
--   from pg_indexes
--   where schemaname = 'public' and tablename = 'atendimentos'
--   order by indexname;
--
--   select relrowsecurity, relforcerowsecurity
--   from pg_class where oid = 'public.atendimentos'::regclass;
--
--   select status, count(*) from public.atendimentos group by status;
--
-- REVISION NOTE 2 (product clarification): Lista da Vez membership and
-- initial daily ordering are established by Iniciar Atividades
-- (registrar_turno_presenca), not by opening /atendimento or by attempting
-- to start an Atendimento. get_lista_vez_estado and iniciar_atendimento no
-- longer insert a queue row for the caller — registrar_turno_presenca
-- (redefined below) does, at the moment Iniciar Atividades completes, so
-- queue order matches the real order employees became operationally ready
-- today. A one-time backfill (also below) joins any employee who already
-- completed Iniciar Atividades today under the old behavior, in their
-- actual check-in order, so today's queue is retroactively correct too.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- atendimentos
--
-- One row per Atendimento session. status transitions: ativo -> concluido,
-- or ativo -> cancelado (only possible within the 20-second provisional
-- window — see cancelar_atendimento_provisorio below). There is no separate
-- "provisional" status: whether an active Atendimento is still provisional
-- is derived from (iniciado_em + 20s) vs now(), per ADR-008 — the server
-- timestamp is authoritative and no client confirmation RPC is required for
-- an Atendimento to become official.
--
-- fora_de_ordem records whether the Atendimento began while the employee was
-- not first in the currently available Lista da Vez (approved by ADR-006 /
-- section 8.5.1) — set once at creation and never revised afterward.
--
-- Creation is guarded: if public.atendimentos already exists (see REVISION
-- NOTE above), this verifies its column shape instead of assuming it, and
-- fails loudly and safely — no rows read, modified, or dropped — if it
-- doesn't match.
-- -----------------------------------------------------------------------------
do $$
declare
  v_problems text[];
begin
  if to_regclass('public.atendimentos') is null then
    create table public.atendimentos (
      id uuid primary key default gen_random_uuid(),
      id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
      status text not null default 'ativo',
      fora_de_ordem boolean not null,
      iniciado_em timestamptz not null default now(),
      concluido_em timestamptz,
      cancelado_em timestamptz
    );
  else
    select array_agg(msg)
    into v_problems
    from (
      select expected.col || ': expected type ' || expected.expected_type ||
             ', found ' || coalesce(c.data_type, 'MISSING COLUMN') as msg
      from (
        values
          ('id', 'uuid'),
          ('id_funcionario', 'uuid'),
          ('status', 'text'),
          ('fora_de_ordem', 'boolean'),
          ('iniciado_em', 'timestamp with time zone'),
          ('concluido_em', 'timestamp with time zone'),
          ('cancelado_em', 'timestamp with time zone')
      ) as expected(col, expected_type)
      left join information_schema.columns c
        on c.table_schema = 'public'
        and c.table_name = 'atendimentos'
        and c.column_name = expected.col
      where c.column_name is null or c.data_type <> expected.expected_type

      union all

      select col || ': is nullable but must be NOT NULL'
      from unnest(array['id_funcionario', 'status', 'fora_de_ordem', 'iniciado_em']) as col
      where exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'atendimentos'
          and c.column_name = col
          and c.is_nullable = 'YES'
      )

      union all

      select 'no primary key constraint found'
      where not exists (
        select 1 from pg_constraint
        where conrelid = 'public.atendimentos'::regclass and contype = 'p'
      )

      union all

      select 'no foreign key from id_funcionario to public.funcionarios found'
      where not exists (
        select 1 from pg_constraint
        where conrelid = 'public.atendimentos'::regclass
          and contype = 'f'
          and pg_get_constraintdef(oid) ilike '%id_funcionario%'
          and pg_get_constraintdef(oid) ilike '%funcionarios%'
      )
    ) problems;

    if v_problems is not null then
      raise exception
        'public.atendimentos already exists but does not match the shape '
        'Milestone 1''s RPCs depend on: %. This table was not created by '
        'this migration (see REVISION NOTE in this file''s header) — '
        'inspect it with the read-only diagnostic queries in this '
        'migration''s header comment and resolve the mismatch manually '
        'before re-applying. No rows were read, modified, or dropped by '
        'this check.',
        array_to_string(v_problems, '; ');
    end if;
  end if;
end $$;

-- Guarded status-value check constraint — added regardless of whether the
-- table above was just created (bare, with no inline checks) or already
-- existed and was verified compatible.
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
      and pg_get_constraintdef(oid) ilike '%concluido%'
      and pg_get_constraintdef(oid) ilike '%cancelado%'
  ) into v_already_protected;

  if not v_already_protected then
    select count(*) into v_violation_count
    from public.atendimentos
    where status not in ('ativo', 'concluido', 'cancelado');

    if v_violation_count > 0 then
      raise exception
        'public.atendimentos has % row(s) with a status value outside '
        '(''ativo'', ''concluido'', ''cancelado''). Resolve these '
        'manually before this migration can add that constraint. '
        'Diagnostic query: select distinct status from '
        'public.atendimentos;',
        v_violation_count;
    end if;

    alter table public.atendimentos
      add constraint atendimentos_status_check
      check (status in ('ativo', 'concluido', 'cancelado'));
  end if;
end $$;

-- Guarded status/timestamp consistency check constraint — same reasoning.
do $$
declare
  v_already_protected boolean;
  v_violation_count int;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.atendimentos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%concluido_em%'
      and pg_get_constraintdef(oid) ilike '%cancelado_em%'
  ) into v_already_protected;

  if not v_already_protected then
    select count(*) into v_violation_count
    from public.atendimentos
    where not (
      (status = 'ativo' and concluido_em is null and cancelado_em is null)
      or (status = 'concluido' and concluido_em is not null and cancelado_em is null)
      or (status = 'cancelado' and cancelado_em is not null and concluido_em is null)
    );

    if v_violation_count > 0 then
      raise exception
        'public.atendimentos has % row(s) whose status/timestamp '
        'combination would violate '
        'atendimentos_status_timestamps_consistentes (e.g. status = '
        '''concluido'' with concluido_em null). Resolve these manually '
        'before this migration can add that constraint. Diagnostic '
        'query: select * from public.atendimentos where not ((status = '
        '''ativo'' and concluido_em is null and cancelado_em is null) or '
        '(status = ''concluido'' and concluido_em is not null and '
        'cancelado_em is null) or (status = ''cancelado'' and '
        'cancelado_em is not null and concluido_em is null));',
        v_violation_count;
    end if;

    alter table public.atendimentos
      add constraint atendimentos_status_timestamps_consistentes check (
        (status = 'ativo' and concluido_em is null and cancelado_em is null)
        or (status = 'concluido' and concluido_em is not null and cancelado_em is null)
        or (status = 'cancelado' and cancelado_em is not null and concluido_em is null)
      );
  end if;
end $$;

-- Database-level guarantee (per section 15.2) that a single employee can
-- never have more than one active Atendimento at a time, independent of any
-- application-level check. Detected by pattern (like turno_presenca's
-- expression index in 20260722_003), since a partial unique index can't be
-- compared by attnum alone; guarded the same fail-closed way as that
-- migration's duplicate preflight.
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
  ) into v_already_protected;

  if not v_already_protected then
    select count(*) into v_duplicate_count
    from (
      select id_funcionario
      from public.atendimentos
      where status = 'ativo'
      group by id_funcionario
      having count(*) > 1
    ) dupes;

    if v_duplicate_count > 0 then
      raise exception
        'public.atendimentos has % employee(s) with more than one status '
        '= ''ativo'' row. Resolve these manually (decide which row per '
        'employee should remain ''ativo'', complete or cancel the '
        'others) before this migration can enforce one active '
        'Atendimento per employee. Diagnostic query: select '
        'id_funcionario, count(*) from public.atendimentos where status '
        '= ''ativo'' group by 1 having count(*) > 1;',
        v_duplicate_count;
    end if;

    create unique index atendimentos_um_ativo_por_funcionario_idx
      on public.atendimentos (id_funcionario)
      where status = 'ativo';
  end if;
end $$;

create index if not exists atendimentos_id_funcionario_idx
  on public.atendimentos (id_funcionario);

alter table public.atendimentos enable row level security;
-- No policies: anon/authenticated have no direct table access. All reads and
-- writes happen exclusively through the SECURITY DEFINER RPCs below, same
-- convention as public.sessoes_funcionario.

-- -----------------------------------------------------------------------------
-- lista_vez_fila
--
-- Persistent Lista da Vez queue state (ADR-014), scoped to one Manaus
-- calendar day per employee — mirrors the existing per-day scoping already
-- used by turno_presenca, and gives every business day a fresh queue rather
-- than carrying stale ordering from a day an employee may not have worked.
--
-- posicao is assigned from a single monotonically increasing sequence
-- whenever an employee joins the queue for the day (at Iniciar Atividades —
-- see registrar_turno_presenca below) or returns to it after completing an
-- Atendimento — i.e. "back of the queue" always means "next value of this
-- sequence". Ordering within a day is simply `order by posicao`. Because an
-- employee's row keeps its posicao for as long as they remain a queue
-- member, and starting an Atendimento only flips `disponivel` to false
-- rather than deleting or renumbering the row, an accidental-start
-- cancellation within the 20-second grace period restores the employee's
-- exact prior queue position for free — no renumbering, no recomputation.
--
-- Confirmed absent in the target database before this migration (see
-- REVISION NOTE above), but created with IF NOT EXISTS/guards regardless so
-- this whole file stays safely re-runnable.
-- -----------------------------------------------------------------------------
create sequence if not exists public.lista_vez_posicao_seq;

create table if not exists public.lista_vez_fila (
  id bigint generated always as identity primary key,
  id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
  dia_manaus date not null,
  posicao bigint not null default nextval('public.lista_vez_posicao_seq'),
  disponivel boolean not null default true,
  atualizado_em timestamptz not null default now(),
  unique (id_funcionario, dia_manaus)
);

create index if not exists lista_vez_fila_dia_disponivel_posicao_idx
  on public.lista_vez_fila (dia_manaus, disponivel, posicao);

alter table public.lista_vez_fila enable row level security;
-- No policies: same convention as above — SECURITY DEFINER RPCs only.

-- -----------------------------------------------------------------------------
-- One-time backfill: any employee who already completed Iniciar Atividades
-- today, before registrar_turno_presenca (redefined below) started joining
-- Lista da Vez automatically, joins the queue now — in the order they
-- actually checked in (not the order this migration happens to process
-- them), so today's Lista da Vez ordering is retroactively correct. Safe to
-- re-run: (id_funcionario, dia_manaus) uniqueness makes this a no-op for
-- anyone already queued. This is a one-time transition only — every future
-- Iniciar Atividades call inserts its own queue row itself, so no ongoing
-- backfill is needed after this migration is applied.
-- -----------------------------------------------------------------------------
insert into public.lista_vez_fila (id_funcionario, dia_manaus)
select
  tp.id_funcionario,
  (tp.checked_in_at at time zone 'America/Manaus')::date as dia_manaus
from public.turno_presenca tp
where (tp.checked_in_at at time zone 'America/Manaus')::date =
      (now() at time zone 'America/Manaus')::date
order by tp.checked_in_at asc
on conflict (id_funcionario, dia_manaus) do nothing;

-- -----------------------------------------------------------------------------
-- registrar_turno_presenca (redefined): identical Iniciar Atividades
-- behavior as 20260722_003_add_turno_presenca_rpcs.sql, plus joining the
-- caller into today's Lista da Vez.
--
-- Product clarification: Lista da Vez membership and initial ordering are
-- established by Iniciar Atividades, not by opening /atendimento or
-- attempting to start an Atendimento (docs/portal-benvisi-blueprint.md
-- section 8.5). Safe to run this insert unconditionally on every call,
-- including idempotent already-checked-in-today calls: the
-- (id_funcionario, dia_manaus) uniqueness on lista_vez_fila makes it a
-- no-op after the first successful join for the day. posicao is assigned
-- from a global monotonic sequence at the moment of this insert; nextval()
-- is allocated atomically and immediately regardless of transaction commit
-- order, so relative Iniciar Atividades completion order is preserved even
-- under concurrent calls. No advisory lock is needed here (unlike
-- iniciar_atendimento/concluir_atendimento below): this is a plain insert
-- of a brand-new row with a globally unique position, never a read-modify
-- of an existing row, so it cannot race with anything.
-- -----------------------------------------------------------------------------
create or replace function public.registrar_turno_presenca(
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_dia date;
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  insert into public.turno_presenca (id_funcionario)
  values (v_ctx.id_funcionario)
  on conflict (id_funcionario, ((checked_in_at at time zone 'America/Manaus')::date))
  do nothing;

  v_dia := (now() at time zone 'America/Manaus')::date;

  insert into public.lista_vez_fila (id_funcionario, dia_manaus)
  values (v_ctx.id_funcionario, v_dia)
  on conflict (id_funcionario, dia_manaus) do nothing;

  return true;
end;
$$;

revoke all on function public.registrar_turno_presenca(text) from public;
grant execute on function public.registrar_turno_presenca(text) to anon;

-- -----------------------------------------------------------------------------
-- get_lista_vez_estado: current-day Lista da Vez, ordered with available
-- employees first (in queue order), then employees currently in Atendimento.
--
-- Read-only: opening /atendimento (or polling this while it's open) must
-- never establish or alter queue membership/priority — see REVISION NOTE 2
-- above. Membership comes exclusively from registrar_turno_presenca.
-- -----------------------------------------------------------------------------
create or replace function public.get_lista_vez_estado(
  p_session_token text
)
returns table (
  id_funcionario uuid,
  nome text,
  em_atendimento boolean,
  ordem int
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
      (not f.disponivel) as em_atendimento,
      case
        when f.disponivel then
          row_number() over (partition by f.disponivel order by f.posicao asc)::int
        else null
      end as ordem
    from public.lista_vez_fila f
    join public.funcionarios fu on fu.id = f.id_funcionario
    where f.dia_manaus = v_dia
    order by f.disponivel desc, f.posicao asc;
end;
$$;

revoke all on function public.get_lista_vez_estado(text) from public;
grant execute on function public.get_lista_vez_estado(text) to anon;

-- -----------------------------------------------------------------------------
-- get_atendimento_ativo: the caller's current active Atendimento, if any —
-- used for resume-after-navigation/refresh (ADR-009) and to drive the
-- 20-second provisional countdown client-side. prazo_provisorio_em is
-- provided so the client never has to compute the deadline itself; the
-- server's iniciado_em remains the single source of truth.
-- -----------------------------------------------------------------------------
create or replace function public.get_atendimento_ativo(
  p_session_token text
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
      a.iniciado_em,
      a.fora_de_ordem,
      a.iniciado_em + interval '20 seconds'
    from public.atendimentos a
    where a.id_funcionario = v_ctx.id_funcionario
      and a.status = 'ativo'
    limit 1;
end;
$$;

revoke all on function public.get_atendimento_ativo(text) from public;
grant execute on function public.get_atendimento_ativo(text) to anon;

-- -----------------------------------------------------------------------------
-- iniciar_atendimento
--
-- Enforces, server-side and in this order (section 8.6):
--   1. valid session (identity resolved server-side, never client-supplied);
--   2. today's Iniciar Atividades was completed — which also guarantees the
--      caller already has a lista_vez_fila row for today (inserted by
--      registrar_turno_presenca), so this function itself never inserts
--      queue membership;
--   3. explicit confirmation if the employee is not first in the currently
--      available queue (ADR-006) — p_confirmar_fora_de_ordem must be true,
--      or the call is rejected with CONFIRMACAO_FORA_DE_ORDEM_NECESSARIA so
--      a client that skips the confirmation dialog cannot start out of turn
--      silently;
--   4. no existing active Atendimento (also guaranteed by the partial unique
--      index on atendimentos, independent of this check).
--
-- The per-day advisory lock serializes concurrent starts (and completions,
-- cancellations, and queue reads) for the same Manaus day, so "am I first"
-- is always decided against a consistent snapshot and two employees cannot
-- simultaneously both be told they are first when only one queue front
-- exists.
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
    where id_funcionario = v_ctx.id_funcionario and status = 'ativo'
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
    -- Defense in depth: the exists-check above already guards against this
    -- under the advisory lock; this only protects against the partial
    -- unique index itself (the true invariant) firing for any other reason.
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
-- cancelar_atendimento_provisorio
--
-- Only valid within the 20-second grace period (section 8.7). The deadline
-- check below (`now() > v_atendimento.iniciado_em + interval '20 seconds'`)
-- compares two exclusively server-controlled values — the database's own
-- transaction timestamp against iniciado_em, which was itself set by
-- `default now()` on the atendimentos table at INSERT time inside
-- iniciar_atendimento above. p_session_token is the only client input this
-- function accepts; there is no code path, timestamp, or parameter here
-- that a client can use to extend, bypass, or spoof the deadline — calling
-- this RPC directly (e.g. via curl or the Supabase client with a valid
-- token) after the real 20 seconds have elapsed is rejected exactly the
-- same as a normal expired click.
--
-- Restores the employee's exact prior queue position by simply flipping
-- disponivel back to true; posicao was never touched, so no recomputation is
-- needed (see lista_vez_fila comment above).
-- -----------------------------------------------------------------------------
create or replace function public.cancelar_atendimento_provisorio(
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
  v_dia date;
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

  if now() > v_atendimento.iniciado_em + interval '20 seconds' then
    raise exception using errcode = 'P0001', message = 'PRAZO_PROVISORIO_EXPIRADO';
  end if;

  v_dia := (v_atendimento.iniciado_em at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'cancelado', cancelado_em = now()
  where id = v_atendimento.id;

  update public.lista_vez_fila
  set disponivel = true, atualizado_em = now()
  where id_funcionario = v_ctx.id_funcionario and dia_manaus = v_dia;

  return true;
end;
$$;

revoke all on function public.cancelar_atendimento_provisorio(text) from public;
grant execute on function public.cancelar_atendimento_provisorio(text) to anon;

-- -----------------------------------------------------------------------------
-- concluir_atendimento
--
-- Milestone 1 provides only the basic completion transition needed to
-- browser-test Lista da Vez return-to-back-of-queue behavior (section
-- 8.5.3). Customer outcome recording, non-conversion motives, and the
-- versioned reset checklist (sections 8.10-8.13) are out of scope for this
-- milestone and will extend this same function (additional parameters plus
-- their own persistence) in a later migration — the completion transition
-- and queue-repositioning behavior implemented here does not change.
--
-- Repositions the employee to the back of *today's* available queue
-- (dia_manaus computed at completion time, not at Atendimento start), using
-- ON CONFLICT so this is correct even for the edge case of an Atendimento
-- that happens to be completed just after a Manaus-day rollover. Because
-- concluir_atendimento's advisory lock is acquired before the insert/update,
-- and every other queue-mutating RPC acquires the same per-day lock,
-- completions that race with other starts/completions/cancellations are
-- fully serialized — the queue can never observe a partial update, and
-- completion order (not start order) determines relative return position
-- per ADR-016.
-- -----------------------------------------------------------------------------
create or replace function public.concluir_atendimento(
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
  v_dia date;
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

  v_dia := (now() at time zone 'America/Manaus')::date;

  perform pg_advisory_xact_lock(hashtext('lista_vez:' || v_dia::text)::bigint);

  update public.atendimentos
  set status = 'concluido', concluido_em = now()
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

revoke all on function public.concluir_atendimento(text) from public;
grant execute on function public.concluir_atendimento(text) to anon;

commit;
