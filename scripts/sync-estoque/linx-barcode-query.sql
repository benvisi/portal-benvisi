/* =============================================================================
   Consulta de Estoque — Barcode Slice 1 — canonical Linx barcode extraction
   =============================================================================
   Produces ONE row per ACTIVE, non-blank barcode of every product/colour the
   store has PREVIOUSLY CARRIED, mapped to its SKU (produto, cor_codigo,
   tamanho_key). The sync script publishes it into public.estoque_barcodes.

   Output columns (exact names; text values are trimmed by the script):

     codigo_barra        PRODUTOS_BARRA.CODIGO_BARRA  (text — leading zeros kept)
     produto             PRODUTOS_BARRA.PRODUTO
     cor_codigo          PRODUTOS_BARRA.COR_PRODUTO
     tamanho_key         PRODUTOS_BARRA.TAMANHO  (same 1..48 position index as
                         linx-query.sql's tamanho_key)
     tamanho_venda       PRODUTOS_TAMANHOS.TAMANHO_<n>  (label, for sold-out SKUs
                         that no longer appear in estoque_atual)
     desc_produto        PRODUTOS.DESC_PRODUTO
     cor_descricao_linx  PRODUTO_CORES.DESC_COR_PRODUTO

   Rules (approved, Trello #13 Slice 1):
     * INATIVO = 0 and a non-blank CODIGO_BARRA only.
     * Several active barcodes per SKU are kept. CODIGO_BARRA_PADRAO is NOT used
       as a filter.
     * Scope (approved): an ESTOQUE_PRODUTOS row exists for @filial for the
       produto+cor, REGARDLESS of quantity (zero and negative included). A
       sold-out colour/reference is recognized instead of looking unknown,
       without importing the whole Linx catalog. Validated on live Linx with
       validate-barcode-scope.sql (2026-11): 5,825 produto+cor, 44,361 source
       barcode records, positive-stock SKU coverage 3,506 / 3,506.
     * Only labelled grade positions 1..48 are emitted (same rule as
       linx-query.sql). Rows whose PRODUTOS / PRODUTO_CORES / grade label is
       missing are dropped by the INNER JOINs (counted by the validation SQL).
     * Normalization happens in estoque-barcode-diff.mjs, not here: trimming,
       length <= 64, dash-only placeholder labels excluded, same-SKU
       duplicates collapsed, and a barcode that maps to different SKUs
       EXCLUDED with an audit warning (resolveBarcodeAmbiguity).
     * This query runs only when a barcode check is due (initial, weekly,
       new produto+cor, manual, retry) — not every hourly run.

   @filial is the same bind parameter as linx-query.sql (default
   'LACOSTE SHOPPING  MANAUS' — note the double space).
   ============================================================================= */

WITH tamanhos AS (
    SELECT
        pt.GRADE,
        v.tamanho_key,
        v.tamanho_venda
    FROM PRODUTOS_TAMANHOS pt
    CROSS APPLY (VALUES
        ( 1, pt.TAMANHO_1 ), ( 2, pt.TAMANHO_2 ), ( 3, pt.TAMANHO_3 ), ( 4, pt.TAMANHO_4 ),
        ( 5, pt.TAMANHO_5 ), ( 6, pt.TAMANHO_6 ), ( 7, pt.TAMANHO_7 ), ( 8, pt.TAMANHO_8 ),
        ( 9, pt.TAMANHO_9 ), (10, pt.TAMANHO_10), (11, pt.TAMANHO_11), (12, pt.TAMANHO_12),
        (13, pt.TAMANHO_13), (14, pt.TAMANHO_14), (15, pt.TAMANHO_15), (16, pt.TAMANHO_16),
        (17, pt.TAMANHO_17), (18, pt.TAMANHO_18), (19, pt.TAMANHO_19), (20, pt.TAMANHO_20),
        (21, pt.TAMANHO_21), (22, pt.TAMANHO_22), (23, pt.TAMANHO_23), (24, pt.TAMANHO_24),
        (25, pt.TAMANHO_25), (26, pt.TAMANHO_26), (27, pt.TAMANHO_27), (28, pt.TAMANHO_28),
        (29, pt.TAMANHO_29), (30, pt.TAMANHO_30), (31, pt.TAMANHO_31), (32, pt.TAMANHO_32),
        (33, pt.TAMANHO_33), (34, pt.TAMANHO_34), (35, pt.TAMANHO_35), (36, pt.TAMANHO_36),
        (37, pt.TAMANHO_37), (38, pt.TAMANHO_38), (39, pt.TAMANHO_39), (40, pt.TAMANHO_40),
        (41, pt.TAMANHO_41), (42, pt.TAMANHO_42), (43, pt.TAMANHO_43), (44, pt.TAMANHO_44),
        (45, pt.TAMANHO_45), (46, pt.TAMANHO_46), (47, pt.TAMANHO_47), (48, pt.TAMANHO_48)
    ) v (tamanho_key, tamanho_venda)
    WHERE NULLIF(LTRIM(RTRIM(v.tamanho_venda)), '') IS NOT NULL
)
SELECT
    RTRIM(pb.CODIGO_BARRA)        AS codigo_barra,
    RTRIM(pb.PRODUTO)             AS produto,
    RTRIM(pb.COR_PRODUTO)         AS cor_codigo,
    t.tamanho_key                 AS tamanho_key,
    RTRIM(t.tamanho_venda)        AS tamanho_venda,
    RTRIM(p.DESC_PRODUTO)         AS desc_produto,
    RTRIM(pc.DESC_COR_PRODUTO)    AS cor_descricao_linx
FROM PRODUTOS_BARRA pb
JOIN PRODUTOS p
  ON p.PRODUTO = pb.PRODUTO
JOIN PRODUTO_CORES pc
  ON pc.PRODUTO = pb.PRODUTO
 AND pc.COR_PRODUTO = pb.COR_PRODUTO
JOIN tamanhos t
  ON t.GRADE = p.GRADE
 AND t.tamanho_key = pb.TAMANHO
WHERE pb.INATIVO = 0
  AND NULLIF(LTRIM(RTRIM(pb.CODIGO_BARRA)), '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM ESTOQUE_PRODUTOS ep
    WHERE ep.FILIAL = @filial
      AND ep.PRODUTO = pb.PRODUTO
      AND ep.COR_PRODUTO = pb.COR_PRODUTO
  )
ORDER BY codigo_barra;
