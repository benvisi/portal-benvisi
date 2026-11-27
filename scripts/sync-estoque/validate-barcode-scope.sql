/* =============================================================================
   Read-only validation of the Barcode Slice 1 Linx scope — run on aplserver
   (database Lacoste_60420) with SSMS / the read-only login. Nothing here
   writes (only a session-local #temp table).

   Mirrors the published set EXACTLY:
     linx-barcode-query.sql (scope + joins + labelled positions 1..48)
     + estoque-barcode-diff.mjs normalization (LTRIM/RTRIM, length <= 64,
       dash-only placeholder labels excluded, same-SKU duplicates collapsed,
       ambiguous barcodes excluded).
   Every row the extraction would drop is counted under the reason it drops.

   Approved scope: active (INATIVO = 0), non-blank barcodes of every
   produto+cor with ANY ESTOQUE_PRODUTOS row for @filial (zero and negative
   stock included).

   Live run 2026-11-27 (owner, 1.71 s): 5,825 produto+cor in scope (1,354
   positive, 4,469 zero, 2 negative); 44,361 source barcode records; 4
   placeholder-size exclusions, no other drops; 44,357 publishable barcodes;
   0 same-SKU duplicates; 0 ambiguous; 44,181 SKUs mapped, 176 with aliases;
   5 leading-zero barcodes; positive-stock SKU coverage 3,476 / 3,476; 0
   negative size quantities within positive-stock produto+cor.

   Set @filial exactly as the sync does (note the DOUBLE space).
   ============================================================================= */
DECLARE @filial VARCHAR(80) = 'LACOSTE SHOPPING  MANAUS';

IF OBJECT_ID('tempdb..#bc') IS NOT NULL DROP TABLE #bc;

-- Every active, non-blank barcode in scope, with each join made OPTIONAL so
-- the rows the extraction's INNER JOINs would silently drop stay visible.
SELECT
    LTRIM(RTRIM(pb.CODIGO_BARRA))                       AS codigo_barra,
    RTRIM(pb.PRODUTO)                                    AS produto,
    RTRIM(pb.COR_PRODUTO)                                AS cor_codigo,
    pb.TAMANHO                                           AS tamanho_key,
    CASE WHEN p.PRODUTO IS NULL THEN 1 ELSE 0 END        AS sem_produto,
    CASE WHEN pc.PRODUTO IS NULL THEN 1 ELSE 0 END       AS sem_cor,
    LTRIM(RTRIM(t.tamanho_venda))                        AS tamanho_venda
INTO #bc
FROM PRODUTOS_BARRA pb
LEFT JOIN PRODUTOS p
  ON p.PRODUTO = pb.PRODUTO
LEFT JOIN PRODUTO_CORES pc
  ON pc.PRODUTO = pb.PRODUTO AND pc.COR_PRODUTO = pb.COR_PRODUTO
LEFT JOIN PRODUTOS_TAMANHOS pt
  ON pt.GRADE = p.GRADE
OUTER APPLY (
    SELECT v.tamanho_venda
    FROM (VALUES
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
    WHERE v.tamanho_key = pb.TAMANHO
) t
WHERE pb.INATIVO = 0
  AND NULLIF(LTRIM(RTRIM(pb.CODIGO_BARRA)), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM ESTOQUE_PRODUTOS ep
              WHERE ep.FILIAL = @filial AND ep.PRODUTO = pb.PRODUTO
                AND ep.COR_PRODUTO = pb.COR_PRODUTO);

-- Classification: the first drop reason that applies, in pipeline order.
ALTER TABLE #bc ADD motivo VARCHAR(40);
UPDATE #bc SET motivo = CASE
    WHEN sem_produto = 1                                   THEN 'drop:sem_produto'
    WHEN sem_cor = 1                                       THEN 'drop:sem_produto_cor'
    WHEN tamanho_key IS NULL OR tamanho_key < 1 OR tamanho_key > 48 THEN 'drop:tamanho_fora_1_48'
    WHEN NULLIF(tamanho_venda, '') IS NULL                 THEN 'drop:posicao_sem_label'
    WHEN tamanho_venda NOT LIKE '%[^-]%'                   THEN 'drop:label_placeholder'
    WHEN LEN(codigo_barra) > 64                            THEN 'drop:codigo_maior_64'
    ELSE 'ok' END;

-- 1. Scope: produto+cor the store carries (any ESTOQUE_PRODUTOS row) by stock sign.
SELECT
    COUNT(*)                                          AS produto_cor_escopo,
    SUM(CASE WHEN ep.ESTOQUE > 0 THEN 1 ELSE 0 END)   AS produto_cor_com_estoque,
    SUM(CASE WHEN ep.ESTOQUE = 0 THEN 1 ELSE 0 END)   AS produto_cor_zerado,
    SUM(CASE WHEN ep.ESTOQUE < 0 THEN 1 ELSE 0 END)   AS produto_cor_negativo
FROM ESTOQUE_PRODUTOS ep
WHERE ep.FILIAL = @filial;

-- 2. Source barcode records in scope and where each one ends up.
SELECT motivo, COUNT(*) AS registros
FROM #bc
GROUP BY motivo
ORDER BY motivo;

-- 3. Ambiguous barcodes among the publishable rows (one code -> more than one
--    SKU). The sync EXCLUDES them (lookup returns NAO_ENCONTRADO) and warns.
SELECT codigo_barra,
       COUNT(DISTINCT CONCAT(produto, '|', cor_codigo, '|', tamanho_key)) AS skus
FROM #bc
WHERE motivo = 'ok'
GROUP BY codigo_barra
HAVING COUNT(DISTINCT CONCAT(produto, '|', cor_codigo, '|', tamanho_key)) > 1
ORDER BY codigo_barra;

-- 4. Expected published mapping size (= estoque_barcodes row count after the
--    first successful load), aliases and leading zeros.
WITH ok AS (
    SELECT DISTINCT codigo_barra, produto, cor_codigo, tamanho_key FROM #bc WHERE motivo = 'ok'
), amb AS (
    SELECT codigo_barra FROM ok GROUP BY codigo_barra HAVING COUNT(*) > 1
), pub AS (
    SELECT * FROM ok WHERE codigo_barra NOT IN (SELECT codigo_barra FROM amb)
)
SELECT
    (SELECT COUNT(*) FROM #bc WHERE motivo = 'ok')                        AS linhas_ok,
    (SELECT COUNT(*) FROM #bc WHERE motivo = 'ok') - (SELECT COUNT(*) FROM ok) AS duplicadas_mesmo_sku,
    (SELECT COUNT(*) FROM amb)                                            AS barcodes_ambiguos,
    (SELECT COUNT(*) FROM pub)                                            AS barcodes_publicaveis,
    (SELECT COUNT(*) FROM (SELECT produto, cor_codigo, tamanho_key FROM pub
                           GROUP BY produto, cor_codigo, tamanho_key) s)  AS skus_com_barcode,
    (SELECT COUNT(*) FROM (SELECT produto, cor_codigo, tamanho_key FROM pub
                           GROUP BY produto, cor_codigo, tamanho_key
                           HAVING COUNT(*) > 1) s)                        AS skus_com_aliases,
    (SELECT COUNT(*) FROM pub WHERE codigo_barra LIKE '0%')               AS barcodes_com_zero_a_esquerda;

-- 5. Coverage: every positive-stock SKU Consulta shows (same rule as
--    linx-query.sql: ESTOQUE > 0, labelled position, size quantity > 0)
--    should have at least one publishable barcode. Expected: sem_barcode = 0.
WITH tam AS (
    SELECT pt.GRADE, v.tamanho_key, v.tamanho_venda
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
), est AS (
    SELECT ep.PRODUTO, ep.COR_PRODUTO, v.tamanho_key, v.qtd
    FROM ESTOQUE_PRODUTOS ep
    CROSS APPLY (VALUES
        ( 1, ep.ES1 ), ( 2, ep.ES2 ), ( 3, ep.ES3 ), ( 4, ep.ES4 ), ( 5, ep.ES5 ),
        ( 6, ep.ES6 ), ( 7, ep.ES7 ), ( 8, ep.ES8 ), ( 9, ep.ES9 ), (10, ep.ES10),
        (11, ep.ES11), (12, ep.ES12), (13, ep.ES13), (14, ep.ES14), (15, ep.ES15),
        (16, ep.ES16), (17, ep.ES17), (18, ep.ES18), (19, ep.ES19), (20, ep.ES20),
        (21, ep.ES21), (22, ep.ES22), (23, ep.ES23), (24, ep.ES24), (25, ep.ES25),
        (26, ep.ES26), (27, ep.ES27), (28, ep.ES28), (29, ep.ES29), (30, ep.ES30),
        (31, ep.ES31), (32, ep.ES32), (33, ep.ES33), (34, ep.ES34), (35, ep.ES35),
        (36, ep.ES36), (37, ep.ES37), (38, ep.ES38), (39, ep.ES39), (40, ep.ES40),
        (41, ep.ES41), (42, ep.ES42), (43, ep.ES43), (44, ep.ES44), (45, ep.ES45),
        (46, ep.ES46), (47, ep.ES47), (48, ep.ES48)
    ) v (tamanho_key, qtd)
    WHERE ep.FILIAL = @filial AND ep.ESTOQUE > 0
), sku AS (
    SELECT DISTINCT RTRIM(e.PRODUTO) AS produto, RTRIM(e.COR_PRODUTO) AS cor_codigo, e.tamanho_key
    FROM est e
    JOIN PRODUTOS p ON p.PRODUTO = e.PRODUTO
    JOIN tam t ON t.GRADE = p.GRADE AND t.tamanho_key = e.tamanho_key
    WHERE e.qtd > 0
), ok AS (
    SELECT DISTINCT codigo_barra, produto, cor_codigo, tamanho_key FROM #bc WHERE motivo = 'ok'
), pub AS (
    SELECT * FROM ok
    WHERE codigo_barra NOT IN (SELECT codigo_barra FROM ok GROUP BY codigo_barra HAVING COUNT(*) > 1)
)
-- (SUM(CASE WHEN EXISTS(...)) is not allowed in SQL Server — error 130 —
-- hence the LEFT JOIN form.)
SELECT
    COUNT(*) AS skus_estoque_positivo,
    COUNT(b.tamanho_key) AS com_barcode,
    COUNT(*) - COUNT(b.tamanho_key) AS sem_barcode
FROM sku s
LEFT JOIN (
    SELECT DISTINCT produto, cor_codigo, tamanho_key
    FROM pub
) b
    ON b.produto = s.produto
    AND b.cor_codigo = s.cor_codigo
    AND b.tamanho_key = s.tamanho_key;

-- 6. Negative size-level quantities among stocked produto+cor (the sync
--    publishes these as 0, never as available).
SELECT COUNT(*) AS tamanhos_negativos
FROM ESTOQUE_PRODUTOS ep
CROSS APPLY (VALUES
    (ep.ES1),(ep.ES2),(ep.ES3),(ep.ES4),(ep.ES5),(ep.ES6),(ep.ES7),(ep.ES8),(ep.ES9),(ep.ES10),
    (ep.ES11),(ep.ES12),(ep.ES13),(ep.ES14),(ep.ES15),(ep.ES16),(ep.ES17),(ep.ES18),(ep.ES19),(ep.ES20),
    (ep.ES21),(ep.ES22),(ep.ES23),(ep.ES24),(ep.ES25),(ep.ES26),(ep.ES27),(ep.ES28),(ep.ES29),(ep.ES30),
    (ep.ES31),(ep.ES32),(ep.ES33),(ep.ES34),(ep.ES35),(ep.ES36),(ep.ES37),(ep.ES38),(ep.ES39),(ep.ES40),
    (ep.ES41),(ep.ES42),(ep.ES43),(ep.ES44),(ep.ES45),(ep.ES46),(ep.ES47),(ep.ES48)
) v (qtd)
WHERE ep.FILIAL = @filial AND ep.ESTOQUE > 0 AND v.qtd < 0;

DROP TABLE #bc;
