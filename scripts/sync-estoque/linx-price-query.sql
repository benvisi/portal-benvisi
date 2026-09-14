/* =============================================================================
   Consulta de Estoque — Price V1 — canonical Linx R3 price extraction
   =============================================================================
   Produces ONE row per (produto, cor_codigo) — the authoritative full/list
   price grain (price varies by color, never by size). Source: PRODUTOS_PRECO_
   COR.PRECO1, restricted to CODIGO_TAB_PRECO = @tabela_preco (Benvisi standard
   store/list-price table — 'R3' "PRECO CHEIO OFICIAL R3", validated against
   TABELAS_PRECO / TABELAS_PRECO_FILIAL and historical LOJA_VENDA usage for
   the Manaus store; the actual value is passed as a bind parameter by the
   sync script, matching the @filial idiom in linx-query.sql, so the table
   code is never scattered as a literal through the codebase).

   Scoped to the SAME qualifying set as linx-query.sql's inventory extraction
   (EXISTS against ESTOQUE_PRODUTOS: FILIAL = @filial AND ESTOQUE > 0) —
   PRODUTOS_PRECO_COR itself is a nationwide/all-stores price table (140 554
   rows for R3 alone across every produto+cor Linx has ever priced), and only
   the ~1 367 produto+cor groups actually in Manaus's current inventory are
   Portal's concern. This keeps estoque_precos_atual as compact as estoque_
   atual_grupos, matching the V2 architecture's "diff a small current-state
   table every run" performance characteristic instead of publishing and
   re-diffing 130 000+ irrelevant nationwide price rows every hourly sync.
   Both extractions run against the same live Linx state within the same
   sync execution, so a produto/cor newly back in stock this run is picked up
   by both queries together — no staleness window between them.

   Output columns (exact names — mapped 1:1 by the sync script into the
   estoque_precos_atual current-state price table):

     produto      PRODUTOS_PRECO_COR.PRODUTO
     cor_codigo   PRODUTOS_PRECO_COR.COR_PRODUTO
     preco        PRODUTOS_PRECO_COR.PRECO1

   Locked rules (Price V1 milestone brief):
     * PRECO1 only — never PRECO_LIQUIDO1 (41 rows in R3 have PRECO_LIQUIDO1 =
       0 while PRECO1 holds a plausible retail price; PRECO_LIQUIDO1 is
       unsuitable for a list-price feature).
     * no promotion/discount interpretation (PROMOCAO_DESCONTO, INICIO_
       PROMOCAO, FIM_PROMOCAO) — this is a full/list-price snapshot only.
     * (CODIGO_TAB_PRECO, PRODUTO, COR_PRODUTO) is unique in R3 — verified
       live (140 554 rows, zero duplicates on 2026-09-14). The sync script
       re-asserts this again before publishing (defense in depth, not because
       it is expected to fail).

   Verified against the live Lacoste_60420 schema (2026-09-14):
     - TABELAS_PRECO: CODIGO_TAB_PRECO='R3', TABELA='PRECO CHEIO OFICIAL R3',
       OBS='TABELA DE PRECO CHEIO DE LOJAS/FRANQUIAS OFICIAL', INATIVO=false.
     - TABELAS_PRECO_FILIAL: R3 x 'LACOSTE SHOPPING  MANAUS' (double space),
       INATIVO=false.
     - Ground truth (ONLY known physical/tag prices): TH6709-23 / 001 -> 429,
       TH6709-23 / QPT -> 399, TH6709-23 / 031 -> 429. Matched exactly.
     - Of the 1 367 produto+cor groups currently in Manaus inventory
       (ESTOQUE_PRODUTOS, ESTOQUE > 0), all 1 367 have a positive R3 PRECO1
       (100% coverage at validation time; PRECO1 = 0 rows exist in R3 only for
       produto/cor combinations NOT currently stocked in Manaus).

   @tabela_preco is passed as a bind parameter by the script (business
   constant, currently 'R3'). @filial is the same bind parameter linx-
   query.sql uses (default 'LACOSTE SHOPPING  MANAUS' — note the double
   space).
   ============================================================================= */

SELECT
    RTRIM(ppc.PRODUTO)     AS produto,
    RTRIM(ppc.COR_PRODUTO) AS cor_codigo,
    ppc.PRECO1             AS preco
FROM PRODUTOS_PRECO_COR ppc
WHERE ppc.CODIGO_TAB_PRECO = @tabela_preco
  AND EXISTS (
    SELECT 1
    FROM ESTOQUE_PRODUTOS ep
    WHERE ep.FILIAL = @filial
      AND ep.ESTOQUE > 0
      AND ep.PRODUTO = ppc.PRODUTO
      AND ep.COR_PRODUTO = ppc.COR_PRODUTO
  )
ORDER BY produto, cor_codigo;
