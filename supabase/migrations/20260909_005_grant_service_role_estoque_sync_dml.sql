begin;

-- =============================================================================
-- Consulta de Estoque backend V1 — allow the backend sync to write
--
-- Depends on 20260909_001.
--
-- On this project the blanket "grant everything to anon/authenticated/
-- service_role" defaults are NOT in effect — newly created public tables end
-- up with only REFERENCES/TRIGGER/TRUNCATE for those roles, and all real
-- access goes through postgres-owned SECURITY DEFINER RPCs. That is exactly
-- what the employee-facing read path does here (20260909_003), and the
-- frontend keeps zero direct access to these tables (RLS enabled, zero
-- policies, no DML/SELECT grant for anon or authenticated).
--
-- The inventory sync, however, is a genuine server-side writer: it runs on
-- the on-prem PC with the Supabase service_role key (never shipped to the
-- browser — browser code uses only the publishable/anon key) and needs to
-- insert the snapshot in bulk. Granting service_role the minimal DML below is
-- the standard Supabase "backend service" pattern; it does not add a table
-- policy, does not weaken RLS, and does not expose anything to anon /
-- authenticated / the frontend.
-- =============================================================================

grant select, insert, update on public.estoque_sync_execucoes to service_role;
grant select, insert            on public.estoque_snapshot        to service_role;

-- service_role never writes the colour dictionary (seeded only by migration),
-- but a read is handy for future sync-side coverage checks.
grant select on public.estoque_cores_mapeamento to service_role;

commit;
