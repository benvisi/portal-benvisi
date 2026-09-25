/**
 * Shared UK -> BR footwear size conversion — the single source of truth
 * consumed by BOTH Consulta de Estoque (inline UK/BR header rows) and
 * Conhecimento & Cultura's "Tamanhos de calçados" reference page.
 *
 * Discovery findings this module encodes:
 * - `estoque_atual.grade` deterministically identifies footwear AND its
 *   segmento: F1 = Masculino, F2 = Feminino, F62 = Infantil. No other grade
 *   overlaps a footwear `linha` in the current inventory (zero leakage,
 *   zero ambiguous products across 86 footwear produtos).
 * - Some Linx `tamanho_venda` labels carry a trailing-comma artifact that is
 *   already present upstream of the Portal, currently isolated to grade F62
 *   (Infantil) tamanho_key 1-8 (e.g. "10,", "11,5,"). Legitimate half sizes
 *   elsewhere use a real decimal comma ("8,5", "9,5") that must never be
 *   touched. Normalization here strips AT MOST ONE TRAILING comma.
 * - The UK -> BR mappings themselves are business-supplied and intentionally
 *   partial (Infantil especially) — never interpolated here.
 */

export type Segmento = "masculino" | "feminino" | "infantil";

export const SEGMENTOS_CALCADO: readonly Segmento[] = ["masculino", "feminino", "infantil"];

export const SEGMENTO_CALCADO_LABEL: Readonly<Record<Segmento, string>> = {
  masculino: "Masculino",
  feminino: "Feminino",
  infantil: "Infantil",
};

const GRADE_SEGMENTO: Readonly<Record<string, Segmento>> = {
  F1: "masculino",
  F2: "feminino",
  F62: "infantil",
};

/**
 * `estoque_atual.grade` -> footwear segmento, or null when the grade is
 * missing/unrecognized. A non-null result also means the produto IS
 * footwear — these grade codes are footwear-only in the current Linx data.
 * An unknown/future grade degrades safely to null: no BR conversion is
 * shown, no exception is raised, and no segmento is guessed.
 */
export function classificarSegmentoCalcado(grade: string | null | undefined): Segmento | null {
  if (!grade) return null;
  return GRADE_SEGMENTO[grade.trim()] ?? null;
}

/**
 * Strips at most one trailing comma (after trimming whitespace) for
 * DISPLAY/LOOKUP purposes only. Never mutates stored data, never touches
 * the sync pipeline, and never removes an embedded decimal comma — "8,5"
 * stays "8,5" (never becomes "8" or "85"); only a literal trailing "," is
 * removed ("10," -> "10", "11,5," -> "11,5").
 */
export function normalizeTamanhoCalcado(tamanhoVenda: string): string {
  return tamanhoVenda.trim().replace(/,$/, "");
}

// Authoritative V1 mappings (business-supplied, do not interpolate). Keys
// are normalized UK size strings using comma-decimal notation — never
// floating-point numbers — so half sizes match exactly regardless of
// upstream formatting quirks.
const UK_PARA_BR: Readonly<Record<Segmento, Readonly<Record<string, number>>>> = {
  masculino: {
    "6": 38,
    "7": 39,
    "8": 40,
    "8,5": 41,
    "9,5": 42,
    "10": 43,
    "11": 44,
  },
  feminino: {
    "3,5": 34,
    "4": 35,
    "5": 36,
    "6": 37,
    "6,5": 38,
    "7,5": 39,
  },
  infantil: {
    "10": 26,
    "11": 27,
    "11,5": 28,
    "12,5": 29,
    "13": 30,
  },
};

/**
 * UK -> BR lookup for one segmento. `tamanhoUk` may be a raw Linx label
 * (e.g. "10,") or an already-normalized one ("10") — both normalize
 * identically before the lookup. Returns undefined when there is no
 * supplied mapping for that size; callers must render "no conversion"
 * (e.g. "—"), never an invented/interpolated value.
 */
export function converterUkParaBr(segmento: Segmento, tamanhoUk: string): number | undefined {
  const chave = normalizeTamanhoCalcado(tamanhoUk);
  return UK_PARA_BR[segmento][chave];
}

/**
 * Ordered [tamanhoUk, tamanhoBr] pairs for one segmento's full reference
 * table, sorted by UK size ascending. Reads the SAME mapping object
 * `converterUkParaBr` uses — Conhecimento & Cultura's reference page must
 * never hard-code a separate copy of these values.
 */
export function getTabelaConversaoCalcado(
  segmento: Segmento,
): ReadonlyArray<readonly [tamanhoUk: string, tamanhoBr: number]> {
  return Object.entries(UK_PARA_BR[segmento])
    .map(([uk, br]) => [uk, br] as const)
    .sort(([ukA], [ukB]) => parseFloat(ukA.replace(",", ".")) - parseFloat(ukB.replace(",", ".")));
}
