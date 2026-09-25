begin;

-- =============================================================================
-- Remove an unnecessary anon SELECT grant on public.funcionarios.
--
-- Audit finding: `anon` held SELECT on every column of funcionarios, including
-- token_pin, with no migration provenance (predates this migration history).
-- RLS is enabled on funcionarios with zero policies, so it currently
-- default-denies all anon reads -- but that leaves the grant as a silent
-- single point of failure: any future RLS policy added to funcionarios for
-- an unrelated reason would immediately expose every column, PIN token
-- included, to anon over the Data API.
--
-- The application never needs this grant: employee listing goes through the
-- SECURITY DEFINER RPC list_active_employees(), and PIN login goes through
-- verify_pin() -- both run as the function owner and do not depend on the
-- caller's table privileges. No RLS or RPC change is required here.
-- =============================================================================

revoke select on public.funcionarios from anon;

commit;
