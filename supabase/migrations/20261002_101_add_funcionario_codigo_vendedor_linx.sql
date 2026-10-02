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
-- Type: text, not integer. Verified against the live Linx SQL Server
-- metadata (sys.columns), not inferred from sample values:
-- dbo.LOJA_VENDA_VENDEDORES.VENDEDOR (the exact column used for attribution)
-- is CHAR(4) — a fixed-width, zero-padding-capable text code, not a numeric
-- type. The current filial 060420 happens to have no leading-zero codes
-- today, but storing this as integer would silently lose any that appear
-- later (here or at another filial) and would require re-deriving the
-- original code to look one up. Comparisons/joins against Linx must use
-- the exact CHAR(4) text value.
--
-- Nullable: not every funcionario is a Linx salesperson (e.g. Caixa,
-- Gerente, Administrador may have no VENDEDOR code at all), and not every
-- Linx VENDEDOR code necessarily has a Portal funcionario yet — an unmapped
-- Linx code is reported by the sync (see the write-path migration), never
-- guessed from a name match.
-- =============================================================================

alter table public.funcionarios
  add column codigo_vendedor_linx text;

alter table public.funcionarios
  add constraint funcionarios_codigo_vendedor_linx_key unique (codigo_vendedor_linx);

commit;
