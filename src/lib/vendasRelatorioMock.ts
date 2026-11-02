import type { VendasMetricasLinha } from "@/lib/vendasRelatorio";

/**
 * STATIC MOCK DATA — not production facts. This is the single boundary to
 * replace with the `get_vendas_metricas_mtd` RPC call (Slice B wiring).
 */
const ATUALIZADO_EM = "2026-10-02T17:55:00Z";

function row(
  nome: string,
  venda: number,
  tickets: number,
  brutas: number,
  trocas: number,
  extra: Partial<VendasMetricasLinha> = {},
): VendasMetricasLinha {
  const liquidas = brutas - trocas;
  return {
    funcionario_id: extra.eh_outros || extra.eh_total ? null : `mock-${nome.toLowerCase()}`,
    vendedor_nome: nome,
    eh_outros: false,
    eh_total: false,
    venda_liquida: venda,
    tickets,
    pecas_brutas: brutas,
    pecas_troca: trocas,
    pecas_liquidas: liquidas,
    ticket_medio: tickets > 0 ? venda / tickets : null,
    pa: tickets > 0 ? liquidas / tickets : null,
    pm: liquidas > 0 ? venda / liquidas : null,
    atualizado_em: ATUALIZADO_EM,
    ...extra,
  };
}

const MOCK_LINHAS: VendasMetricasLinha[] = [
  row("Amanda", 48230.9, 61, 118, 9),
  row("Graça", 71542.35, 84, 171, 12),
  row("Dayanna", 39876.1, 55, 97, 6),
  row("Elisieth", 62410.0, 72, 149, 15),
  row("Renan", 27115.6, 41, 70, 3),
  row("Vitor", 15980.4, 26, 44, 2),
  row("Outros", 4320.0, 6, 11, 1, { eh_outros: true }),
  // Independent store total (mock): sum of the rows above.
  row("Total", 269475.35, 345, 660, 48, { eh_total: true }),
];

export async function getVendasMetricasMtdMock(): Promise<VendasMetricasLinha[]> {
  return MOCK_LINHAS.map((l) => ({ ...l }));
}
