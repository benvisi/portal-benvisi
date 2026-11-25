/* =============================================================================
   Read-only validation of the Barcode Slice 1 Linx scope — run on aplserver
   (database Lacoste_60420) with the owner's SSMS / read-only login BEFORE
   enabling barcode sync in the scheduled task. Nothing here writes.

   Set @filial exactly as the sync does (note the DOUBLE space).
   ============================================================================= */
DECLARE @filial VARCHAR(80) = 'LACOSTE SHOPPING  MANAUS';

-- 1. How many produto+cor does the store "carry" (any ESTOQUE_PRODUTOS row)
--    vs. only those with stock today? Large gap = sold-out history exists.
SELECT
    COUNT(*)                                          AS produto_cor_com_linha,
    SUM(CASE WHEN ep.ESTOQUE > 0 THEN 1 ELSE 0 END)   AS produto_cor_com_estoque,
    SUM(CASE WHEN ep.ESTOQUE = 0 THEN 1 ELSE 0 END)   AS produto_cor_zerado,
    SUM(CASE WHEN ep.ESTOQUE < 0 THEN 1 ELSE 0 END)   AS produto_cor_negativo
FROM ESTOQUE_PRODUTOS ep
WHERE ep.FILIAL = @filial;

-- 2. Expected size of the published barcode set (active, non-blank, carried).
SELECT COUNT(*) AS barcodes_ativos_escopo
FROM PRODUTOS_BARRA pb
WHERE pb.INATIVO = 0
  AND NULLIF(LTRIM(RTRIM(pb.CODIGO_BARRA)), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM ESTOQUE_PRODUTOS ep
              WHERE ep.FILIAL = @filial AND ep.PRODUTO = pb.PRODUTO
                AND ep.COR_PRODUTO = pb.COR_PRODUTO);

-- 3. Ambiguous barcodes within scope (one barcode -> more than one SKU).
--    The sync EXCLUDES these and warns; expected 0.
SELECT RTRIM(pb.CODIGO_BARRA) AS codigo_barra,
       COUNT(DISTINCT CONCAT(RTRIM(pb.PRODUTO), '|', RTRIM(pb.COR_PRODUTO), '|', pb.TAMANHO)) AS skus
FROM PRODUTOS_BARRA pb
WHERE pb.INATIVO = 0
  AND NULLIF(LTRIM(RTRIM(pb.CODIGO_BARRA)), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM ESTOQUE_PRODUTOS ep
              WHERE ep.FILIAL = @filial AND ep.PRODUTO = pb.PRODUTO
                AND ep.COR_PRODUTO = pb.COR_PRODUTO)
GROUP BY RTRIM(pb.CODIGO_BARRA)
HAVING COUNT(DISTINCT CONCAT(RTRIM(pb.PRODUTO), '|', RTRIM(pb.COR_PRODUTO), '|', pb.TAMANHO)) > 1;

-- 4. (positions 1..20 only) Active barcodes in scope whose TAMANHO has no label in the
--    product's grade (these are dropped by the sync). Expected 0.
SELECT COUNT(*) AS barcodes_sem_label
FROM PRODUTOS_BARRA pb
JOIN PRODUTOS p ON p.PRODUTO = pb.PRODUTO
JOIN PRODUTOS_TAMANHOS pt ON pt.GRADE = p.GRADE
WHERE pb.INATIVO = 0
  AND NULLIF(LTRIM(RTRIM(pb.CODIGO_BARRA)), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM ESTOQUE_PRODUTOS ep
              WHERE ep.FILIAL = @filial AND ep.PRODUTO = pb.PRODUTO
                AND ep.COR_PRODUTO = pb.COR_PRODUTO)
  AND NULLIF(LTRIM(RTRIM(CASE pb.TAMANHO
        WHEN 1 THEN pt.TAMANHO_1 WHEN 2 THEN pt.TAMANHO_2 WHEN 3 THEN pt.TAMANHO_3
        WHEN 4 THEN pt.TAMANHO_4 WHEN 5 THEN pt.TAMANHO_5 WHEN 6 THEN pt.TAMANHO_6
        WHEN 7 THEN pt.TAMANHO_7 WHEN 8 THEN pt.TAMANHO_8 WHEN 9 THEN pt.TAMANHO_9
        WHEN 10 THEN pt.TAMANHO_10 WHEN 11 THEN pt.TAMANHO_11 WHEN 12 THEN pt.TAMANHO_12
        WHEN 13 THEN pt.TAMANHO_13 WHEN 14 THEN pt.TAMANHO_14 WHEN 15 THEN pt.TAMANHO_15
        WHEN 16 THEN pt.TAMANHO_16 WHEN 17 THEN pt.TAMANHO_17 WHEN 18 THEN pt.TAMANHO_18
        WHEN 19 THEN pt.TAMANHO_19 WHEN 20 THEN pt.TAMANHO_20 ELSE NULL END)), '') IS NULL;
