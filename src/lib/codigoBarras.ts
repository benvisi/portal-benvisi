import type { EstoqueMatriz } from "@/lib/estoque";

/**
 * Barcode Slice 2 — pure helpers for exact barcode entry in Consulta de
 * Estoque. No React, no data fetching.
 *
 * A barcode is always handled as TEXT: leading zeros are significant and are
 * never stripped, padded or converted to a number. Only surrounding
 * whitespace (and the CR/LF/TAB a USB scanner may append) is trimmed,
 * matching the backend's btrim in get_estoque_por_codigo_barra.
 */
export function normalizarCodigoBarra(valor: string): string {
  return valor.trim();
}

/** Same upper bound the sync enforces for a publishable barcode. */
export const CODIGO_BARRA_MAX_CHARS = 64;
/** Shortest standard retail barcode (EAN-8). */
export const CODIGO_BARRA_MIN_DIGITOS = 8;
/**
 * Every current Linx reference is 6–11 characters and none is digits-only
 * (checked on live inventory, 2026-11-27). A single token at least this long
 * cannot be a reference, so it is worth an exact barcode lookup even when it
 * contains letters (some Linx barcodes are internal alphanumeric codes).
 */
export const CODIGO_BARRA_MIN_ALFANUMERICO = 12;

const SOMENTE_DIGITOS = /^\d+$/;
const TEM_ESPACO = /\s/;

/**
 * Decides whether a SUBMITTED term (Enter / scanner) should first be resolved
 * as an exact barcode. Deliberately conservative — a numeric term is NOT
 * assumed to be a barcode:
 *   * short numbers (< 8 digits) keep the normal produto search;
 *   * multi-word terms are always text searches;
 *   * an exact produto match in the suggestions always wins (checked by the
 *     caller before this).
 */
export function isCandidatoCodigoBarra(termo: string): boolean {
  const codigo = normalizarCodigoBarra(termo);
  if (codigo.length === 0 || codigo.length > CODIGO_BARRA_MAX_CHARS) return false;
  if (TEM_ESPACO.test(codigo)) return false;
  if (SOMENTE_DIGITOS.test(codigo)) return codigo.length >= CODIGO_BARRA_MIN_DIGITOS;
  return codigo.length >= CODIGO_BARRA_MIN_ALFANUMERICO;
}

/**
 * A digits-only candidate is unambiguously a barcode attempt: when it is not
 * found the employee sees "Código de barras não encontrado". An alphanumeric
 * candidate that is not a known barcode falls back to the ordinary produto
 * search so nothing that used to work stops working.
 */
export function isCodigoBarraSomenteDigitos(termo: string): boolean {
  return SOMENTE_DIGITOS.test(normalizarCodigoBarra(termo));
}

/**
 * The scanned-colour view: the same matrix restricted to one colour, keeping
 * every applicable size column of the produto (zero-stock sizes included).
 * Returns null when the colour has no row in the current snapshot.
 */
export function filtrarMatrizPorCor(
  matriz: EstoqueMatriz,
  corCodigo: string,
): EstoqueMatriz | null {
  const cores = matriz.cores.filter((cor) => cor.codigo === corCodigo);
  if (cores.length === 0) return null;
  return { ...matriz, cores };
}
