import {
  ADMINISTRATOR_CARGO,
  MANAGER_CARGO,
  RELATORIO_VENDAS_OUTROS_LABEL,
  RELATORIO_VENDAS_PERIODO_PADRAO,
  RELATORIO_VENDAS_PERIODOS,
  RELATORIO_VENDAS_TOTAL_LABEL,
} from "@/config/constants";

/**
 * Client-side visibility/route guard for Relatório de vendas (V1 interim
 * policy: Gerente + Administrador). This is UX only — the cargo here comes
 * from the stored session; get_vendas_metricas_periodo enforces the same rule
 * server-side from the validated session, which is the real protection.
 */
export function canViewRelatorioVendas(cargo: string | null | undefined): boolean {
  return cargo === ADMINISTRATOR_CARGO || cargo === MANAGER_CARGO;
}

/** Period keys accepted by `get_vendas_metricas_periodo` (validated server-side too). */
export type VendasPeriodo = (typeof RELATORIO_VENDAS_PERIODOS)[number]["value"];

export const VENDAS_PERIODO_PADRAO: VendasPeriodo = RELATORIO_VENDAS_PERIODO_PADRAO;

export function isVendasPeriodo(value: unknown): value is VendasPeriodo {
  return RELATORIO_VENDAS_PERIODOS.some((periodo) => periodo.value === value);
}

/**
 * Relatório de vendas (Trello #12). Row shape mirrors the columns returned
 * by the `get_vendas_metricas_periodo` RPC (same shape as the older
 * `get_vendas_metricas_mtd`).
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
  atualizado_em: string | null;
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

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // PostgREST may serialize `numeric` as a string; accept only numeric text.
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  const n = toNumber(value);
  return n === null ? undefined : n;
}

/**
 * Validates one RPC row. Returns null for anything that does not match the
 * contract so the caller can fail loudly instead of rendering bad numbers.
 */
export function parseVendasMetricasLinha(value: unknown): VendasMetricasLinha | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  const venda = toNumber(c.venda_liquida);
  const tickets = toNumber(c.tickets);
  const brutas = toNumber(c.pecas_brutas);
  const troca = toNumber(c.pecas_troca);
  const liquidas = toNumber(c.pecas_liquidas);
  const ticketMedio = toNullableNumber(c.ticket_medio);
  const pa = toNullableNumber(c.pa);
  const pm = toNullableNumber(c.pm);
  if (
    typeof c.vendedor_nome !== "string" ||
    typeof c.eh_outros !== "boolean" ||
    typeof c.eh_total !== "boolean" ||
    (c.funcionario_id !== null && typeof c.funcionario_id !== "string") ||
    (c.atualizado_em !== null && typeof c.atualizado_em !== "string") ||
    venda === null ||
    tickets === null ||
    brutas === null ||
    troca === null ||
    liquidas === null ||
    ticketMedio === undefined ||
    pa === undefined ||
    pm === undefined
  ) {
    return null;
  }
  return {
    funcionario_id: c.funcionario_id as string | null,
    vendedor_nome: c.vendedor_nome,
    eh_outros: c.eh_outros,
    eh_total: c.eh_total,
    venda_liquida: venda,
    tickets,
    pecas_brutas: brutas,
    pecas_troca: troca,
    pecas_liquidas: liquidas,
    ticket_medio: ticketMedio,
    pa,
    pm,
    atualizado_em: c.atualizado_em as string | null,
  };
}

/** User-facing row label: the RPC's "Total da loja" is shown as "Total". */
export function getVendasLinhaLabel(linha: VendasMetricasLinha): string {
  if (linha.eh_total) return RELATORIO_VENDAS_TOTAL_LABEL;
  if (linha.eh_outros) return RELATORIO_VENDAS_OUTROS_LABEL;
  return linha.vendedor_nome;
}

/** Latest non-null freshness timestamp across all rows, or null. */
export function getVendasAtualizadoEm(linhas: readonly VendasMetricasLinha[]): string | null {
  let latest: string | null = null;
  for (const l of linhas) {
    if (l.atualizado_em && (latest === null || Date.parse(l.atualizado_em) > Date.parse(latest))) {
      latest = l.atualizado_em;
    }
  }
  return latest;
}

/** No salesperson rows and nothing sold in the month so far. */
export function isRelatorioVendasVazio(linhas: readonly VendasMetricasLinha[]): boolean {
  const { vendedores, outros, total } = organizarLinhasVendas(linhas);
  return (
    vendedores.length === 0 &&
    outros === null &&
    (total === null || (total.venda_liquida === 0 && total.tickets === 0))
  );
}
