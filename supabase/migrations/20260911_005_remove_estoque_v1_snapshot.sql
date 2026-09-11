begin;

-- =============================================================================
-- Consulta de Estoque — retire V1 full-snapshot storage
--
-- V2 (20260911_001..004) replaced "insert a full new snapshot every sync run"
-- with the current-state table estoque_atual, and 20260911_003 cut all three
-- employee-facing read RPCs (get_estoque_freshness, buscar_produtos_estoque,
-- get_produto_estoque_detalhe) over to it. V2 has been merged, smoke-tested,
-- and production-active since.
--
-- Live dependency audit before this migration (pg_depend on estoque_snapshot,
-- plus a pg_proc.prosrc scan of every function in public for both object
-- names) found:
--   - no view, matview, or trigger depends on estoque_snapshot
--   - estoque_snapshot's only foreign key is its own outbound reference to
--     estoque_sync_execucoes (dropped automatically with the table)
--   - no function anywhere in public still calls estoque_sync_atual() or
--     reads estoque_snapshot; the three read RPCs read estoque_atual /
--     estoque_freshness_atual() exclusively (confirmed from their live
--     pg_get_functiondef)
--   - estoque_snapshot has RLS enabled with zero policies (nothing to drop
--     there either)
--
-- Both objects are dead. Dropping them without CASCADE so an unexpected
-- dependency this audit missed fails the migration loudly instead of
-- silently taking something else down.
--
-- estoque_sync_execucoes (shared audit ledger, used by both V1 and V2) and
-- estoque_cores_mapeamento are untouched, per explicit instruction.
-- =============================================================================

drop function public.estoque_sync_atual();

drop table public.estoque_snapshot;

commit;
