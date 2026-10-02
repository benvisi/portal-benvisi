begin;

-- =============================================================================
-- Salesperson Metrics Portal V1 — Slice A (production sales-metrics data feed).
--
-- Explicit Portal funcionario <-> Linx salesperson-code mapping. Required
-- because scripts/sales-metrics-reconciliation/ locked the attribution rule
-- as "exactly one distinct VENDEDOR code from dbo.LOJA_VENDA_VENDEDORES" —
-- that code is a Linx identifier, not a Portal funcionario id, and the two
-- must never be joined by name (CLAUDE.md: "Employee roles always come from
-- the database" / never trust inferred identity). This column is the only
-- place that mapping is recorded.
--
-- Nullable: not every funcionario is a Linx salesperson (e.g. Caixa,
-- Gerente, Administrador may have no VENDEDOR code at all), and not every
-- Linx VENDEDOR code necessarily has a Portal funcionario yet — an unmapped
-- Linx code is reported by the sync (see the write-path migration), never
-- guessed from a name match.
-- =============================================================================

alter table public.funcionarios
  add column codigo_vendedor_linx integer;

alter table public.funcionarios
  add constraint funcionarios_codigo_vendedor_linx_key unique (codigo_vendedor_linx);

commit;
