\set ON_ERROR_STOP on
-- =============================================================================
-- Portal Benvisi baseline — 00: prerequisites
--
-- NOT a migration. NEVER run against an existing database. psql only.
-- Run as the project's postgres role, in ONE psql invocation together with
-- 10_schema_public.sql and 20_reference_data.sql (see README.md).
-- =============================================================================

-- Guard: a blank Supabase project has no tables in public. Anything else is
-- an existing database (e.g. production or QA) and must never be touched.
do $guard$
begin
  if exists (select 1 from pg_catalog.pg_tables where schemaname = 'public') then
    raise exception 'baseline refused: schema public already contains tables (existing Portal database?). The baseline only builds a blank environment.';
  end if;
end
$guard$;

-- citext: funcionarios.apelido/email/escala_nome_planilha are citext. It must
-- live in public (as in production) and exist before any table is created.
-- No IF NOT EXISTS on purpose: an already-installed citext (possibly in
-- another schema) means the target is not the expected blank project.
create extension citext with schema public;

-- pgcrypto: hash_session_token / issue_employee_session call
-- extensions.digest() and extensions.gen_random_bytes(). Supabase normally
-- pre-installs it in schema extensions.
create extension if not exists pgcrypto with schema extensions;

do $check$
begin
  if (select e.extnamespace::regnamespace::text from pg_catalog.pg_extension e
      where e.extname = 'pgcrypto') is distinct from 'extensions' then
    raise exception 'baseline refused: pgcrypto must be installed in schema extensions.';
  end if;
end
$check$;

-- Default privileges for objects the postgres role creates in public, set
-- BEFORE 10_schema_public.sql creates anything. Production grants nothing by
-- default to anon/authenticated/service_role; every grant is explicit per
-- object (and is reproduced by 10_schema_public.sql). Without this, objects
-- would inherit a fresh project's broader defaults and diverge from
-- production. The GRANT ... TO postgres lines make the result identical to
-- production regardless of the new project's starting defaults.
alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;
