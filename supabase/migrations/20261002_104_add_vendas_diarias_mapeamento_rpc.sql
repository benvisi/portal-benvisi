begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A — mapping lookup for the on-prem
-- sync.
--
-- public.vendas_diarias_mapeamento_vendedores() returns the current Linx
-- VENDEDOR code -> funcionario mapping, so the sync script can resolve each
-- day's aggregated vendedor codes to a funcionario_id before writing. This
-- is a SECURITY DEFINER RPC (not a direct table grant) so the sync's
-- service_role key never needs SELECT on funcionarios itself (which also
-- holds token_pin) — "Prefer RPCs over exposing tables directly" /
-- "service_role direct table access must also be explicit and
-- least-privilege" (CLAUDE.md).
--
-- Only funcionarios with a mapped codigo_vendedor_linx are returned. The
-- sync script treats any Linx VENDEDOR code resolved from a ticket that is
-- NOT present in this result as "unmapped" and reports it clearly — it
-- never falls back to matching by name.
-- =============================================================================

create or replace function public.vendas_diarias_mapeamento_vendedores()
returns table (
  funcionario_id uuid,
  codigo_vendedor_linx integer,
  nome text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select f.id, f.codigo_vendedor_linx, f.nome::text
    from public.funcionarios f
    where f.codigo_vendedor_linx is not null;
end;
$$;

revoke all on function public.vendas_diarias_mapeamento_vendedores() from public;
grant execute on function public.vendas_diarias_mapeamento_vendedores() to service_role;

commit;
