begin;

-- =============================================================================
-- Trello #38: cor_codigo 2R3 (Linx description 'RESEDA 07Y') was seeded in
-- 20260909_002 as 'Verde-reseda' / 'Verde'. The physical garment (e.g.
-- L1212-23 / L121223) is pink/coral and its label reads "pink-2r3" — the
-- Linx description misled the original curation. Corrected here rather than
-- editing the historical seed migration, so this fix reproduces on any
-- environment rebuild.
--
-- Scope: exactly one row, keyed by (cor_codigo, cor_descricao_linx) per this
-- table's documented mapping key — no other color code or SKU is affected.
-- =============================================================================

update public.estoque_cores_mapeamento
set
  cor_nome_portal = 'Rosa-coral',
  cor_familia = 'Rosa',
  updated_at = now()
where cor_codigo = '2R3'
  and cor_descricao_linx = 'RESEDA 07Y';

commit;
