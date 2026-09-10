/* =============================================================================
   Consulta de Estoque — canonical Linx inventory extraction
   =============================================================================
   Produces ONE row per (produto, cor_codigo, tamanho_key) for every
   qualifying product/colour, restricted to the APPLICABLE / LABELLED size
   positions of that product's grade — every real size, including applicable
   sizes whose stock quantity is 0. Unused/unlabelled padding positions are
   NOT emitted, even though Linx physically stores up to ES1..ES48.

   Output columns (exact names — the sync script maps these 1:1 into
   public.estoque_snapshot; every text value is RTRIM-ed by the script):

     produto             PRODUTOS.PRODUTO
     desc_produto        PRODUTOS.DESC_PRODUTO
     tipo_produto        PRODUTOS.TIPO_PRODUTO
     linha               PRODUTOS.LINHA
     grade               PRODUTOS.GRADE  (source product grade)
     cor_codigo          PRODUTO_CORES.COR_PRODUTO
     cor_descricao_linx  PRODUTO_CORES.DESC_COR_PRODUTO
     tamanho_key         1..48  (deterministic source ordering position;
                         INTERNAL ordering metadata only, never shown to
                         employees)
     tamanho_venda       PRODUTOS_TAMANHOS.TAMANHO_<n>  (dynamic size label,
                         always non-null/non-blank in the output)
     quantidade_estoque  ESTOQUE_PRODUTOS.ES<n>

   Locked rules:
     * qualify a product/colour with  ep.FILIAL = @filial AND ep.ESTOQUE > 0
     * read ALL 48 physical Linx positions (ES1..ES48 and TAMANHO_1..48) so a
       future grade using positions 21-48 cannot silently disappear — there is
       NO hard-coded Portal maximum (current merchandise happens to top out at
       tamanho_key = 20, but that is data, not a limit)
     * emit a position ONLY when its mapped tamanho_venda is non-null and
       non-blank (NULLIF(LTRIM(RTRIM(tamanho_venda)),'') IS NOT NULL). A
       position is discarded because it is unlabelled for that grade, never
       because its key exceeds some number.
     * dash-only placeholder labels ("-", "--", "---") are handled in the
       normalization layer of sync-estoque.mjs, NOT here: dropped when their
       quantidade_estoque is 0; kept (with a sync warning) when non-zero, so
       stock is never silently lost. The rule is content-based (/^-+$/) — no
       hard-coded key/produto/grade list — so a position that later receives a
       real label flows through automatically.
     * keep applicable positions even when quantidade_estoque = 0
     * retain tamanho_key for deterministic grade ordering
     * do NOT join PRODUTOS_BARRA in this milestone
     * (produto, cor_codigo, tamanho_key) is unique in the result — the
       script asserts this again before publishing

   Verified against the live Lacoste_60420 schema:
     - PRODUTOS_TAMANHOS is keyed by GRADE only (no PRODUTO column); GRADE is
       unique (502 rows / 502 distinct). Joined via PRODUTOS.GRADE.
     - PRODUTOS.PRODUTO and PRODUTO_CORES (PRODUTO, COR_PRODUTO) are unique,
       so the joins do not fan out.
     - ESTOQUE_PRODUTOS holds one row per (PRODUTO, COR_PRODUTO, FILIAL) with
       aggregate ESTOQUE + ES1..ES48. `= @filial` matches the intended
       'LACOSTE SHOPPING  MANAUS' (double space) and, thanks to ANSI
       trailing-space semantics, not the legacy 'LACOSTE SHOPPING MANAUS'.
     - Padding check (fixed-48 vs labelled): of 65 808 fixed-48 rows, 50 302
       are unlabelled padding and ALL of them are quantidade_estoque = 0
       (0 positive, 0 negative). Every positive quantity sits on a labelled
       position. So dropping padding loses no stock information.

   @filial is passed as a bind parameter by the script (default
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
    -- keep only APPLICABLE / LABELLED positions of the grade (dynamic; no key cap)
    WHERE NULLIF(LTRIM(RTRIM(v.tamanho_venda)), '') IS NOT NULL
),
estoque AS (
    SELECT
        ep.PRODUTO,
        ep.COR_PRODUTO,
        v.tamanho_key,
        v.quantidade_estoque
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
    ) v (tamanho_key, quantidade_estoque)
    WHERE ep.FILIAL = @filial
      AND ep.ESTOQUE > 0
)
SELECT
    RTRIM(p.PRODUTO)              AS produto,
    RTRIM(p.DESC_PRODUTO)         AS desc_produto,
    RTRIM(p.TIPO_PRODUTO)         AS tipo_produto,
    RTRIM(p.LINHA)                AS linha,
    RTRIM(p.GRADE)                AS grade,
    RTRIM(pc.COR_PRODUTO)         AS cor_codigo,
    RTRIM(pc.DESC_COR_PRODUTO)    AS cor_descricao_linx,
    e.tamanho_key                 AS tamanho_key,
    RTRIM(t.tamanho_venda)        AS tamanho_venda,
    e.quantidade_estoque          AS quantidade_estoque
FROM estoque e
JOIN PRODUTOS p
  ON p.PRODUTO = e.PRODUTO
JOIN PRODUTO_CORES pc
  ON pc.PRODUTO = e.PRODUTO
 AND pc.COR_PRODUTO = e.COR_PRODUTO
-- INNER JOIN: drops the unlabelled padding positions (tamanhos holds only
-- labelled grade positions), keeping applicable sizes with 0 stock.
JOIN tamanhos t
  ON t.GRADE = p.GRADE
 AND t.tamanho_key = e.tamanho_key
ORDER BY produto, cor_codigo, tamanho_key;
