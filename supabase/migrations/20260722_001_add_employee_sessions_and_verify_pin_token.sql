begin;

-- =============================================================================
-- Secure employee sessions and verify_pin session-token issuance
--
-- STATUS: COMPLETE. The exact live definition and metadata of
-- public.verify_pin(uuid, text) were supplied by the Product Owner and are
-- preserved exactly below — same input validation, same four-digit PIN
-- format check, same employee lookup (id + token_pin + is_active), same
-- generic INVALID_CREDENTIALS response that never reveals which condition
-- failed. The only behavioral addition is session-token issuance after a
-- successful match, via the already-independent public.issue_employee_session
-- helper defined further down in this file.
--
-- Because adding a session_token output column changes the function's
-- return type, and CREATE OR REPLACE FUNCTION cannot change an existing
-- function's return type, this uses DROP FUNCTION immediately followed by
-- CREATE FUNCTION within this same migration transaction — so there is
-- never a window, visible to any other connection, where verify_pin does
-- not exist. Exactly one function named public.verify_pin(uuid, text) is
-- left behind; there is no verify_pin_core and no permanent wrapper.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- pgcrypto: schema detection and safe installation.
--
-- Finding: this environment cannot run
--   select e.extname, n.nspname as extension_schema
--   from pg_extension e join pg_namespace n on n.oid = e.extnamespace
--   where e.extname = 'pgcrypto';
-- directly either (same tooling limitation as verify_pin above). Unlike
-- verify_pin, guessing wrong here fails LOUDLY and safely at apply time
-- (a clear "schema does not match" exception below, or a missing-function
-- error) rather than silently corrupting security-critical logic — so this
-- migration proceeds on the documented Supabase default (pgcrypto installed
-- in the `extensions` schema) and self-verifies that assumption before
-- proceeding. If your project's pgcrypto lives elsewhere, this block will
-- tell you exactly what to change.
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_schema is null then
    raise exception
      'pgcrypto extension is not installed and could not be auto-installed. '
      'Install it manually (e.g. create extension pgcrypto with schema '
      'extensions;) before applying this migration.';
  end if;

  if v_schema <> 'extensions' then
    raise exception
      'pgcrypto is installed in schema "%", not "extensions" as this '
      'migration assumes. Update every extensions.digest(...) / '
      'extensions.gen_random_bytes(...) reference in this file to '
      '"%".digest(...) / "%".gen_random_bytes(...) before applying.',
      v_schema, v_schema, v_schema;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Session table.
-- -----------------------------------------------------------------------------
create table if not exists public.sessoes_funcionario (
  -- gen_random_uuid() is intentionally left unqualified: on the target
  -- PostgreSQL version it is a built-in pg_catalog function (available
  -- since PostgreSQL 13), unlike digest() and gen_random_bytes() below,
  -- which are only provided by the pgcrypto extension and are therefore
  -- explicitly schema-qualified (extensions.digest / extensions.gen_random_bytes).
  id uuid primary key default gen_random_uuid(),
  id_funcionario uuid not null references public.funcionarios(id) on delete cascade,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz null
);

create index if not exists sessoes_funcionario_id_funcionario_idx
  on public.sessoes_funcionario (id_funcionario);

alter table public.sessoes_funcionario enable row level security;
-- No policies are added: anon/authenticated have no direct access. All reads
-- and writes happen exclusively through the SECURITY DEFINER functions below.
-- Multiple valid sessions per employee are intentionally allowed (no unique
-- constraint on id_funcionario alone) — logging in on a second device does
-- not revoke the first.

-- -----------------------------------------------------------------------------
-- Hashing helper. Centralized so the algorithm choice lives in one place.
--
-- SHA-256 (deterministic, unsalted) is appropriate here specifically because
-- session tokens are high-entropy random values (32 bytes = 256 bits), not
-- low-entropy user-chosen secrets like passwords. Deterministic hashing is
-- what allows direct equality lookup by token_hash; a salted/slow hash
-- (bcrypt/scrypt/argon2) would defeat that lookup and provides no meaningful
-- extra protection for a value an attacker can never feasibly guess or
-- brute force in the first place.
-- -----------------------------------------------------------------------------
create or replace function public.hash_session_token(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

revoke all on function public.hash_session_token(text) from public;
-- Not granted to anon: internal helper only, called from within the
-- SECURITY DEFINER functions in this file.

-- -----------------------------------------------------------------------------
-- Internal session-context helper.
--
-- Returns only the authorization context backend RPCs actually need today
-- (id_funcionario, cargo) — not a broad employee profile. Returns no row for
-- an invalid, unknown, expired, revoked, or inactive session; callers cannot
-- distinguish which condition failed, by design.
--
-- "Active" is checked directly against funcionarios.is_active, not by
-- calling public.list_active_employees() — that RPC is an external
-- employee-listing interface for the login screen and must not become an
-- internal authorization dependency (its purpose, shape, or filtering could
-- change independently of session validation semantics).
-- -----------------------------------------------------------------------------
create or replace function public.get_valid_employee_session_context(
  p_session_token text
)
returns table (
  id_funcionario uuid,
  cargo text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_session_token is null or length(p_session_token) = 0 then
    return;
  end if;

  return query
    select f.id, f.cargo
    from public.sessoes_funcionario s
    join public.funcionarios f on f.id = s.id_funcionario
    where s.token_hash = public.hash_session_token(p_session_token)
      and s.revogado_em is null
      and s.expira_em > now()
      and f.is_active = true
    limit 1;
end;
$$;

revoke all on function public.get_valid_employee_session_context(text) from public;
-- Not granted to anon: internal helper only, called from within the
-- SECURITY DEFINER RPCs in this and subsequent migrations.

-- -----------------------------------------------------------------------------
-- Session issuance, kept as its own function rather than inlined into
-- verify_pin so token generation/storage logic has a single, independently
-- reviewable definition — verify_pin (below) just calls it after a
-- successful PIN check.
--
-- Deliberately NOT granted to anon, and not safe to ever grant to anon:
-- calling this directly with an arbitrary id_funcionario, with no preceding
-- PIN check, would let anyone mint a valid session for any employee. It
-- must only ever be invoked from within a trusted, already-authenticated
-- context such as verify_pin.
-- -----------------------------------------------------------------------------
create or replace function public.issue_employee_session(
  p_id_funcionario uuid
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_raw_token text;
begin
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.sessoes_funcionario (id_funcionario, token_hash, expira_em)
  values (
    p_id_funcionario,
    public.hash_session_token(v_raw_token),
    now() + interval '12 hours'
  );

  return v_raw_token;
end;
$$;

revoke all on function public.issue_employee_session(uuid) from public;
-- Intentionally not granted to any role — internal only, see note above.

-- -----------------------------------------------------------------------------
-- verify_pin: PIN-validation logic preserved exactly from the live
-- definition supplied by the Product Owner, restructured only enough to
-- capture the matched employee row into a variable (instead of returning
-- the query directly) so that its id is available to pass into
-- issue_employee_session before the final RETURN. The WHERE conditions,
-- LIMIT 1, error codes, and control flow (including relying on FOUND after
-- the lookup, exactly as the original did after its RETURN QUERY) are
-- unchanged.
--
-- DROP + CREATE (not CREATE OR REPLACE) because session_token is a new
-- output column — see file header. Both statements run back-to-back in
-- this same migration transaction.
-- -----------------------------------------------------------------------------
drop function public.verify_pin(uuid, text);

create function public.verify_pin(
    p_funcionario_id uuid,
    p_pin text
)
returns table(
    success boolean,
    funcionario_id uuid,
    nome text,
    cargo text,
    error_code text,
    session_token text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_employee record;
    v_session_token text;
begin

    -- --------------------------------------------------------
    -- Validate the input format.
    --
    -- This rejects:
    --   - missing employee ID
    --   - missing PIN
    --   - PINs that are not exactly four numeric digits
    -- --------------------------------------------------------

    if p_funcionario_id is null
       or p_pin is null
       or p_pin !~ '^[0-9]{4}$' then

        return query
        select
            false,
            null::uuid,
            null::text,
            null::text,
            'INVALID_INPUT'::text,
            null::text;

        return;
    end if;


    -- --------------------------------------------------------
    -- Validate employee, PIN, and active status.
    --
    -- cargo comes directly from the database. The browser does
    -- not choose or submit the employee's role.
    -- --------------------------------------------------------

    select f.id, f.nome::text, f.cargo::text
    into v_employee
    from public.funcionarios f
    where f.id = p_funcionario_id
      and f.token_pin = p_pin
      and f.is_active = true
    limit 1;

    if found then
        v_session_token := public.issue_employee_session(v_employee.id);

        return query
        select
            true,
            v_employee.id,
            v_employee.nome,
            v_employee.cargo,
            null::text,
            v_session_token;

        return;
    end if;


    -- --------------------------------------------------------
    -- If no employee matched, return one generic error.
    --
    -- We deliberately do not reveal whether:
    --   - the employee was inactive;
    --   - the PIN was incorrect;
    --   - the employee ID did not exist.
    -- --------------------------------------------------------

    return query
    select
        false,
        null::uuid,
        null::text,
        null::text,
        'INVALID_CREDENTIALS'::text,
        null::text;

end;
$function$;

revoke all on function public.verify_pin(uuid, text) from public;
grant execute on function public.verify_pin(uuid, text) to anon;

-- -----------------------------------------------------------------------------
-- Sign-out: revoke a session immediately. Idempotent and safe for unknown,
-- already-revoked, or expired tokens — always succeeds silently so this
-- endpoint never confirms or denies whether a given token was ever valid.
-- Only the supplied session is revoked; other active sessions for the same
-- employee (e.g. another device) are left untouched.
-- -----------------------------------------------------------------------------
create or replace function public.revoke_employee_session(p_session_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_session_token is null or length(p_session_token) = 0 then
    return;
  end if;

  update public.sessoes_funcionario
  set revogado_em = now()
  where token_hash = public.hash_session_token(p_session_token)
    and revogado_em is null
    and expira_em > now();
end;
$$;

revoke all on function public.revoke_employee_session(text) from public;
grant execute on function public.revoke_employee_session(text) to anon;

commit;
