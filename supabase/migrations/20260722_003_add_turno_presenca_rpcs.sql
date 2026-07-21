begin;

-- =============================================================================
-- turno_presenca correction, uniqueness, and RPCs
--
-- Depends on public.get_valid_employee_session_context(text) from
-- 20260722_001_add_employee_sessions_and_verify_pin_token.sql — apply that
-- migration first.
--
-- Finding (unchanged from prior review): this environment has no
-- service-role access. Every attempt to read public.turno_presenca (row
-- count, min/max checked_in_at, duplicate check) via the public anon key
-- returns 401 "permission denied for table turno_presenca" — confirmed the
-- table exists but its contents are unreadable from here. Total row count,
-- minimum/maximum checked_in_at, and whether duplicate per-employee-per-day
-- records already exist remain UNVERIFIED. The block below performs that
-- duplicate check at migration-apply time instead, when the applying role
-- will have full visibility, and refuses to proceed if incompatible data is
-- found. No rows are read, modified, or deleted by this migration outside
-- of that check.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- checked_in_at default correction.
--
-- The previous default, timezone('America/Manaus'::text, now()), is not
-- appropriate for a timestamptz column: the two-argument timezone(zone,
-- timestamptz) form returns a timestamp WITHOUT time zone — the Manaus
-- wall-clock reading of the instant, with zone information stripped. When
-- that naive value is implicitly cast back into this timestamptz column,
-- PostgreSQL reinterprets those wall-clock numbers using the database
-- session's own TimeZone setting (typically UTC on Supabase), not
-- 'America/Manaus'. Unless the session timezone happens to already be
-- America/Manaus, this silently shifts the stored instant by the offset
-- between the two zones. Plain now() stores the instant correctly and
-- unambiguously regardless of session timezone; America/Manaus is applied
-- only when computing the operational calendar date, as done below.
--
-- This changes the DEFAULT only — it does not touch any existing row, per
-- "do not modify historical turno_presenca timestamps automatically".
-- ---------------------------------------------------------------------------
alter table public.turno_presenca
  alter column checked_in_at set default now();

-- ---------------------------------------------------------------------------
-- Uniqueness detection: does an existing unique index already cover
-- id_funcionario + ((checked_in_at AT TIME ZONE 'America/Manaus')::date),
-- under any name? Expression indexes cannot be compared by attnum the way
-- plain-column indexes can (pg_index.indkey holds 0 for expression key
-- columns), so this checks the index's rendered definition instead —
-- pragmatic rather than a perfect semantic-equivalence check, but far more
-- reliable than assuming a specific object name.
-- ---------------------------------------------------------------------------
do $$
declare
  v_already_protected boolean;
  v_duplicate_count int;
begin
  select exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.turno_presenca'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%id_funcionario%'
      and pg_get_indexdef(i.indexrelid) ilike '%checked_in_at%'
      and pg_get_indexdef(i.indexrelid) ilike '%america/manaus%'
  ) into v_already_protected;

  if not v_already_protected then
    -- Fail-closed duplicate preflight: refuse to create the index if
    -- incompatible data already exists. No rows are modified either way.
    select count(*) into v_duplicate_count
    from (
      select
        id_funcionario,
        (checked_in_at at time zone 'America/Manaus')::date as dia_manaus
      from public.turno_presenca
      group by id_funcionario, (checked_in_at at time zone 'America/Manaus')::date
      having count(*) > 1
    ) dupes;

    if v_duplicate_count > 0 then
      raise exception
        'turno_presenca has % employee/day duplicate group(s) under '
        'America/Manaus. Resolve these manually (decide which row to keep '
        'per group) before applying this migration — no rows were '
        'modified. Diagnostic query: select id_funcionario, '
        '(checked_in_at at time zone ''America/Manaus'')::date as '
        'dia_manaus, count(*) from public.turno_presenca group by 1, 2 '
        'having count(*) > 1;',
        v_duplicate_count;
    end if;

    create unique index turno_presenca_id_funcionario_dia_manaus_key
      on public.turno_presenca (
        id_funcionario,
        ((checked_in_at at time zone 'America/Manaus')::date)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- get_turno_presenca_hoje: whether the employee has already registered the
-- beginning of today's activities (America/Manaus calendar day). Never
-- returns or exposes the timestamp itself. Identity comes exclusively from
-- the validated session context.
-- ---------------------------------------------------------------------------
create or replace function public.get_turno_presenca_hoje(
  p_session_token text
)
returns boolean
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

  return exists (
    select 1
    from public.turno_presenca
    where id_funcionario = v_ctx.id_funcionario
      and (checked_in_at at time zone 'America/Manaus')::date =
          (now() at time zone 'America/Manaus')::date
  );
end;
$$;

revoke all on function public.get_turno_presenca_hoje(text) from public;
grant execute on function public.get_turno_presenca_hoje(text) to anon;

-- ---------------------------------------------------------------------------
-- registrar_turno_presenca: idempotent and concurrency-safe via the unique
-- expression protection above. checked_in_at is left to its (now corrected)
-- default of now() — the exact timestamp is stored for operational
-- integrity and duplicate prevention, never returned to the client.
-- ---------------------------------------------------------------------------
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
begin
  select * into v_ctx from public.get_valid_employee_session_context(p_session_token);
  if v_ctx.id_funcionario is null then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION';
  end if;

  -- Verified: PostgreSQL's ON CONFLICT unique-index inference matches any
  -- unique index whose columns/expressions equal this list, regardless of
  -- order (per the INSERT ... ON CONFLICT documentation) — a standalone
  -- expression index is exactly what this targets, no named constraint is
  -- required. The expression below is character-for-character identical to
  -- the one in the unique index created above, so it parses to the same
  -- expression tree and inference succeeds.
  insert into public.turno_presenca (id_funcionario)
  values (v_ctx.id_funcionario)
  on conflict (id_funcionario, ((checked_in_at at time zone 'America/Manaus')::date))
  do nothing;

  return true;
end;
$$;

revoke all on function public.registrar_turno_presenca(text) from public;
grant execute on function public.registrar_turno_presenca(text) to anon;

commit;
