import { RELATORIO_VENDAS_VISOES } from "@/config/constants";
import type { VendasPeriodo } from "@/lib/vendasRelatorio";

/** Views of Relatório de vendas: salesperson table vs. store-level comparison. */
export type VendasVisao = (typeof RELATORIO_VENDAS_VISOES)[number]["value"];

export function isVendasVisao(value: unknown): value is VendasVisao {
  return RELATORIO_VENDAS_VISOES.some((visao) => visao.value === value);
}

/**
 * One comparison window as returned by `get_vendas_comparativo_periodo`
 * (store totals only). `anos_atras` 0 is the current window; the RPC resolves
 * every date server-side, the browser never sends one.
 */
export interface VendasComparativoJanela {
  anos_atras: number;
  data_inicio: string;
  data_fim: string;
  venda_liquida: number;
  tickets: number;
  pecas_liquidas: number;
  ticket_medio: number | null;
  pa: number | null;
  pm: number | null;
  atualizado_em: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
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

/** Validates one RPC row; null means the contract was broken (caller fails loudly). */
export function parseVendasComparativoJanela(value: unknown): VendasComparativoJanela | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  const anosAtras = toNumber(c.anos_atras);
  const venda = toNumber(c.venda_liquida);
  const tickets = toNumber(c.tickets);
  const liquidas = toNumber(c.pecas_liquidas);
  const ticketMedio = toNullableNumber(c.ticket_medio);
  const pa = toNullableNumber(c.pa);
  const pm = toNullableNumber(c.pm);
  if (
    anosAtras === null ||
    !Number.isInteger(anosAtras) ||
    typeof c.data_inicio !== "string" ||
    !ISO_DATE.test(c.data_inicio) ||
    typeof c.data_fim !== "string" ||
    !ISO_DATE.test(c.data_fim) ||
    (c.atualizado_em !== null && typeof c.atualizado_em !== "string") ||
    venda === null ||
    tickets === null ||
    liquidas === null ||
    ticketMedio === undefined ||
    pa === undefined ||
    pm === undefined
  ) {
    return null;
  }
  return {
    anos_atras: anosAtras,
    data_inicio: c.data_inicio,
    data_fim: c.data_fim,
    venda_liquida: venda,
    tickets,
    pecas_liquidas: liquidas,
    ticket_medio: ticketMedio,
    pa,
    pm,
    atualizado_em: c.atualizado_em as string | null,
  };
}

/**
 * Relative change of `atual` against `anterior` as a fraction (0.1 = +10%).
 * No baseline (null, zero or non-positive) means no meaningful percentage.
 */
export function calcularVariacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior <= 0) return null;
  return (atual - anterior) / anterior;
}

export interface VendasComparativoVariacoes {
  venda: number | null;
  pecas: number | null;
  tickets: number | null;
  pa: number | null;
  ticketMedio: number | null;
  pm: number | null;
}

export interface VendasComparativoLinha {
  janela: VendasComparativoJanela;
  /** Compact first-column label (year, month/year, or "até dd/mm/aa"). */
  rotulo: string;
  /** True for the current window (the newest row). */
  atual: boolean;
  /** Change against the previous (older) row; all null for the oldest row. */
  variacoes: VendasComparativoVariacoes;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function partesData(iso: string): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return { ano, mes, dia };
}

/** "19/11/2026" from an ISO date, without any timezone conversion. */
export function formatDataCurta(iso: string): string {
  const { ano, mes, dia } = partesData(iso);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

/** "qui 19/11/2026". */
export function formatDataComSemana(iso: string): string {
  const { ano, mes, dia } = partesData(iso);
  const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  return `${DIAS_SEMANA[diaSemana]} ${formatDataCurta(iso)}`;
}

/**
 * Compact first-column label. Years are counted back from the current
 * window's year (the "hoje" window of an older year can fall in December of
 * the previous calendar year, but it is still that year's row).
 */
export function rotuloJanela(
  periodo: VendasPeriodo,
  janela: VendasComparativoJanela,
  anoAtual: number,
): string {
  const fim = partesData(janela.data_fim);
  switch (periodo) {
    case "mes":
      return `${MESES[fim.mes - 1]}/${fim.ano}`;
    case "ultimos_12_meses":
      return `até ${String(fim.dia).padStart(2, "0")}/${String(fim.mes).padStart(2, "0")}/${String(fim.ano).slice(-2)}`;
    default:
      return String(anoAtual - janela.anos_atras);
  }
}

/** Secondary explanation of the exact window behind a row. */
export function descricaoJanela(periodo: VendasPeriodo, janela: VendasComparativoJanela): string {
  if (periodo === "hoje") return formatDataComSemana(janela.data_fim);
  return `${formatDataCurta(janela.data_inicio)} – ${formatDataCurta(janela.data_fim)}`;
}

/**
 * Rows oldest → newest. Each row's %Δ compares it with the row immediately
 * before it (the previous comparison year); the oldest row has no baseline.
 * Ratios (PA, Ticket Méd., PM) come from the server, derived from summed
 * bases, and are compared as-is — daily ratios are never averaged here.
 */
export function montarLinhasComparativo(
  periodo: VendasPeriodo,
  janelas: readonly VendasComparativoJanela[],
): VendasComparativoLinha[] {
  const ordenadas = [...janelas].sort((a, b) => b.anos_atras - a.anos_atras);
  const atual = ordenadas.find((j) => j.anos_atras === 0) ?? ordenadas[ordenadas.length - 1];
  const anoAtual = atual ? partesData(atual.data_fim).ano : 0;

  return ordenadas.map((janela, i) => {
    const anterior = i > 0 ? ordenadas[i - 1] : null;
    return {
      janela,
      rotulo: rotuloJanela(periodo, janela, anoAtual),
      atual: janela === atual,
      variacoes: {
        venda: calcularVariacao(janela.venda_liquida, anterior?.venda_liquida ?? null),
        pecas: calcularVariacao(janela.pecas_liquidas, anterior?.pecas_liquidas ?? null),
        tickets: calcularVariacao(janela.tickets, anterior?.tickets ?? null),
        pa: calcularVariacao(janela.pa, anterior?.pa ?? null),
        ticketMedio: calcularVariacao(janela.ticket_medio, anterior?.ticket_medio ?? null),
        pm: calcularVariacao(janela.pm, anterior?.pm ?? null),
      },
    };
  });
}

const variacaoFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "+12,3%", "−4,1%", "0,0%", or "—" when there is no baseline. */
export function formatVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const pontos = Math.round(variacao * 1000) / 10;
  if (pontos === 0) return "0,0%";
  const texto = `${variacaoFormat.format(Math.abs(pontos))}%`;
  return pontos > 0 ? `+${texto}` : `−${texto}`;
}

export type VariacaoTom = "positivo" | "negativo" | "neutro";

/** Tone follows the displayed (rounded) value, so "0,0%" is never coloured. */
export function tomVariacao(variacao: number | null): VariacaoTom {
  if (variacao === null) return "neutro";
  const pontos = Math.round(variacao * 1000) / 10;
  if (pontos > 0) return "positivo";
  if (pontos < 0) return "negativo";
  return "neutro";
}

/** Nothing sold in any compared window. */
export function isComparativoVazio(janelas: readonly VendasComparativoJanela[]): boolean {
  return janelas.every((j) => j.venda_liquida === 0 && j.tickets === 0);
}

/** Latest freshness timestamp across windows, or null. */
export function getComparativoAtualizadoEm(
  janelas: readonly VendasComparativoJanela[],
): string | null {
  let latest: string | null = null;
  for (const j of janelas) {
    if (j.atualizado_em && (latest === null || Date.parse(j.atualizado_em) > Date.parse(latest))) {
      latest = j.atualizado_em;
    }
  }
  return latest;
}
