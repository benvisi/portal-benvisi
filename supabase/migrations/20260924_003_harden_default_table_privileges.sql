begin;

-- =============================================================================
-- Codify the default table-privilege baseline for public schema.
--
-- Audit finding: this project's live database already grants only
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (never SELECT/INSERT/UPDATE/DELETE) to
-- anon/authenticated/service_role by default for new tables owned by
-- postgres in public -- but that state exists only in the live database, not
-- in any migration, so it is not reproducible via a fresh `supabase db
-- reset` / new environment.
--
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN are not reachable through the Data
-- API (PostgREST only speaks SELECT/INSERT/UPDATE/DELETE/EXECUTE), but none
-- of the three roles has a legitimate reason to hold them at the raw
-- Postgres level either. This migration removes them from the default ACL
-- and makes the resulting "no automatic table privileges" baseline explicit
-- and reproducible, ahead of Supabase's October 30, 2026 change to stop
-- auto-granting Data API access to new public tables.
--
-- This only affects DEFAULT privileges applied to tables created AFTER this
-- migration runs. It does not touch privileges already granted on existing
-- tables (including the narrow, intentional service_role grants on the
-- estoque sync tables) -- see 20260909_005_grant_service_role_estoque_sync_dml.sql
-- and later estoque migrations for those.
--
-- Every future table-creating migration must continue explicitly granting
-- only the specific privilege(s) a role genuinely needs; see CLAUDE.md.
-- =============================================================================

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain
  on tables
  from anon, authenticated, service_role;

commit;
