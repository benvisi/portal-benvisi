import { ESTOQUE_COR_NAO_MAPEADA_LABEL, LOCALE_PT_BR, MANAUS_TIMEZONE } from "@/config/constants";
import type { EstoqueProdutoDetalheLinha } from "@/integrations/supabase/contracts";

/**
 * Milestone 4E — pure helpers for the Consulta de Estoque matrix. No React,
 * no data fetching. The RPC returns a flat list of one row per
 * (cor_codigo, tamanho_key); the UI needs a single coherent
 * colour x applicable-size matrix, so the reshape lives here.
 */

/**
 * The friendly colour name for display. `cor_codigo` is always shown
 * separately as the primary operational identifier; this is the secondary
 * descriptor. When the snapshot colour has no friendly mapping the RPC
 * returns a null cor_nome_portal — a neutral fallback is used, never
 * cor_descricao_linx (which the RPC never exposes anyway).
 */
export function corNomeExibicao(corNomePortal: string | null): string {
  const nome = corNomePortal?.trim();
  return nome && nome.length > 0 ? nome : ESTOQUE_COR_NAO_MAPEADA_LABEL;
}

/** One applicable consumer-facing size column, ordered by tamanho_key. */
export interface EstoqueTamanhoColuna {
  key: number;
  venda: string;
}

/** One colour row: its identity plus quantities keyed by tamanho_key. */
export interface EstoqueCorLinha {
  /** Primary operational identifier — always shown, visually prominent. */
  codigo: string;
  /** Secondary friendly descriptor, already resolved (fallback applied). */
  nome: string;
  /** tamanho_key -> quantidade_estoque (only entries the snapshot holds). */
  quantidades: Map<number, number>;
}

export interface EstoqueMatriz {
  produto: string;
  descProduto: string | null;
  tipoProduto: string | null;
  linha: string | null;
  syncConcluidoEm: string | null;
  tamanhos: EstoqueTamanhoColuna[];
  cores: EstoqueCorLinha[];
}

/**
 * Reshapes the flat detail rows into the locked matrix model. Columns are the
 * distinct applicable `tamanho_venda` positions ordered by `tamanho_key`
 * (never a hard-coded grade, never `tamanho_key` itself). Rows are the
 * distinct colours in the RPC's order (already cor_codigo ascending).
 * Returns null when there are no rows (produto not in the current snapshot).
 */
export function buildEstoqueMatriz(
  linhas: readonly EstoqueProdutoDetalheLinha[],
): EstoqueMatriz | null {
  if (linhas.length === 0) return null;

  const tamanhosPorKey = new Map<number, string>();
  const coresPorCodigo = new Map<string, EstoqueCorLinha>();

  for (const linha of linhas) {
    if (!tamanhosPorKey.has(linha.tamanho_key)) {
      tamanhosPorKey.set(linha.tamanho_key, linha.tamanho_venda);
    }

    let cor = coresPorCodigo.get(linha.cor_codigo);
    if (!cor) {
      cor = {
        codigo: linha.cor_codigo,
        nome: corNomeExibicao(linha.cor_nome_portal),
        quantidades: new Map<number, number>(),
      };
      coresPorCodigo.set(linha.cor_codigo, cor);
    }
    cor.quantidades.set(linha.tamanho_key, linha.quantidade_estoque);
  }

  const tamanhos: EstoqueTamanhoColuna[] = [...tamanhosPorKey.entries()]
    .map(([key, venda]) => ({ key, venda }))
    .sort((a, b) => a.key - b.key);

  const first = linhas[0];

  return {
    produto: first.produto,
    descProduto: first.desc_produto,
    tipoProduto: first.tipo_produto,
    linha: first.linha,
    syncConcluidoEm: first.sync_concluido_em,
    tamanhos,
    cores: [...coresPorCodigo.values()],
  };
}

/**
 * "10/09/2026 às 09:05" — full Manaus-local date and time, for the
 * "Estoque atualizado em ..." freshness indicator. Never time-only.
 */
export function formatEstoqueFreshness(iso: string): string {
  const date = new Date(iso);
  const data = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const hora = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${data} às ${hora}`;
}
