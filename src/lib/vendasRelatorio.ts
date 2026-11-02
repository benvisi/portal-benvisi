/**
 * Relatório de vendas (Trello #12, Slice B). Row shape mirrors the columns
 * returned by the `get_vendas_metricas_mtd` RPC so the mock provider can be
 * swapped for the real call without touching the table component.
 */
export interface VendasMetricasLinha {
  funcionario_id: string | null;
  vendedor_nome: string;
  eh_outros: boolean;
  eh_total: boolean;
  venda_liquida: number;
  tickets: number;
  pecas_brutas: number;
  pecas_troca: number;
  pecas_liquidas: number;
  ticket_medio: number | null;
  pa: number | null;
  pm: number | null;
  atualizado_em: string;
}

const EMPTY_VALUE = "—";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlWhole = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// Intl inserts a non-breaking space after "R$"; the report shows "R$928".
function noSpaceAfterSymbol(formatted: string): string {
  return formatted.replace(/R\$\s+/, "R$");
}

export function formatBrl(value: number | null): string {
  return value === null ? EMPTY_VALUE : noSpaceAfterSymbol(brl.format(value));
}

/** Whole-reais BRL for the large "R$" (venda l�quida) column. */
export function formatBrlWhole(value: number | null): string {
  return value === null ? EMPTY_VALUE : noSpaceAfterSymbol(brlWhole.format(value));
}

export function formatInteger(value: number | null): string {
  return value === null ? EMPTY_VALUE : integer.format(value);
}

export function formatPa(value: number | null): string {
  return value === null ? EMPTY_VALUE : decimal1.format(value);
}

/**
 * Splits the RPC rows into the display order: salespeople by net sales
 * (descending), then `Outros`, then `Total`. The sort is stable and does not
 * rely on the server order.
 */
export function organizarLinhasVendas(linhas: readonly VendasMetricasLinha[]) {
  const vendedores = linhas
    .filter((l) => !l.eh_outros && !l.eh_total)
    .sort((a, b) => b.venda_liquida - a.venda_liquida);
  const outros = linhas.find((l) => l.eh_outros) ?? null;
  const total = linhas.find((l) => l.eh_total) ?? null;
  return { vendedores, outros, total };
}

/** "Atualizado em 02/10/2026 às 13:55" in the store's timezone (Manaus). */
export function formatVendasAtualizadoEm(iso: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Manaus",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `Atualizado em ${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
}
