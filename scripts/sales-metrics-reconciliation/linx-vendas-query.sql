-- =============================================================================
-- Salesperson Metrics — dry-run reconciliation — canonical Linx extraction
--
-- Output: ONE row per (CODIGO_FILIAL, TICKET, DATA_VENDA), i.e. one row per
-- ticket in dbo.LOJA_VENDA for the bound @filial + [@data_inicio, @data_fim)
-- half-open range, carrying:
--   - the ticket-level monetary/quantity facts from dbo.LOJA_VENDA;
--   - the resolved responsible-salesperson attribution from
--     dbo.LOJA_VENDA_VENDEDORES, collapsed to DISTINCT (filial, ticket,
--     data_venda, vendedor) and reduced to a single vendedor ONLY when
--     exactly one distinct VENDEDOR exists for that ticket;
--   - the salesperson's display name/apelido from dbo.LOJA_VENDEDORES, joined
--     only when attribution resolved to exactly one vendedor.
--
-- LOCKED rule (Joshua, confirmed against filial 060420 / 2026 data):
--   - LOJA_VENDA_VENDEDORES may have >1 row per ticket, but a valid ticket
--     resolves to exactly ONE DISTINCT VENDEDOR. This query does NOT assume
--     that holds for every filial/period it is pointed at — it reports
--     `vendedores_distintos` per ticket so the caller can detect ANY
--     deviation (0 or >1) as an anomaly, rather than silently trusting it.
--   - This query deliberately does NOT use LOJA_VENDA.VENDEDOR for
--     attribution. That field is Power BI's existing (and intentionally
--     different) attribution source.
--
-- This query is READ-ONLY (a single SELECT). It performs no writes of any
-- kind and must never be edited to do so.
--
-- Bind parameters:
--   @filial       varchar  — CODIGO_FILIAL to extract (V1 test value: '060420')
--   @data_inicio  date     — inclusive start of DATA_VENDA range
--   @data_fim     date     — EXCLUSIVE end of DATA_VENDA range (half-open)
-- =============================================================================

WITH atribuicao AS (
    SELECT
        CODIGO_FILIAL,
        TICKET,
        DATA_VENDA,
        COUNT(DISTINCT VENDEDOR) AS vendedores_distintos,
        MIN(VENDEDOR)            AS vendedor_resolvido
    FROM dbo.LOJA_VENDA_VENDEDORES
    WHERE CODIGO_FILIAL = @filial
      AND DATA_VENDA >= @data_inicio
      AND DATA_VENDA <  @data_fim
    GROUP BY CODIGO_FILIAL, TICKET, DATA_VENDA
)
SELECT
    v.CODIGO_FILIAL                              AS codigo_filial,
    v.TICKET                                     AS ticket,
    v.DATA_VENDA                                 AS data_venda,
    v.VALOR_PAGO                                 AS valor_pago,
    v.QTDE_TOTAL                                 AS qtde_total,
    v.QTDE_TROCA_TOTAL                           AS qtde_troca_total,
    v.DATA_HORA_CANCELAMENTO                     AS data_hora_cancelamento,
    COALESCE(a.vendedores_distintos, 0)          AS vendedores_distintos,
    CASE WHEN a.vendedores_distintos = 1
         THEN a.vendedor_resolvido ELSE NULL END AS vendedor_codigo,
    lv.NOME_VENDEDOR                             AS vendedor_nome,
    lv.VENDEDOR_APELIDO                          AS vendedor_apelido
FROM dbo.LOJA_VENDA v
LEFT JOIN atribuicao a
       ON a.CODIGO_FILIAL = v.CODIGO_FILIAL
      AND a.TICKET        = v.TICKET
      AND a.DATA_VENDA    = v.DATA_VENDA
LEFT JOIN dbo.LOJA_VENDEDORES lv
       ON lv.CODIGO_FILIAL = v.CODIGO_FILIAL
      AND lv.VENDEDOR = CASE WHEN a.vendedores_distintos = 1
                              THEN a.vendedor_resolvido ELSE NULL END
WHERE v.CODIGO_FILIAL = @filial
  AND v.DATA_VENDA >= @data_inicio
  AND v.DATA_VENDA <  @data_fim
ORDER BY v.DATA_VENDA, v.TICKET;
