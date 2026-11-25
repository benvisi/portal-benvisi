// =============================================================================
// Consulta de Estoque — Barcode Slice 1 — barcode current-state diff engine
// =============================================================================
// Grain: codigo_barra (text, leading zeros preserved — never coerced to a
// number). Same shape as estoque-price-diff.mjs: finalize -> detect ambiguity ->
// validate -> diff against the current estoque_barcodes state.
//
// Independent of the inventory group hash: a barcode-only change (inventory
// quantities unchanged) must still publish, so it never depends on the
// inventory diff finding anything to stage.
// =============================================================================

const MAX_BARCODE_LENGTH = 64;

// Fields compared to decide "alterado". Everything the table stores besides the
// key and sync metadata.
const CONTENT_FIELDS = [
  "produto",
  "cor_codigo",
  "tamanho_key",
  "tamanho_venda",
  "desc_produto",
  "cor_descricao_linx",
];

const trimOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/** Trims text fields and coerces tamanho_key; codigo_barra stays a string. */
export function finalizeBarcodeRow(r) {
  return {
    codigo_barra: r.codigo_barra == null ? "" : String(r.codigo_barra).trim(),
    produto: r.produto == null ? "" : String(r.produto).trim(),
    cor_codigo: r.cor_codigo == null ? "" : String(r.cor_codigo).trim(),
    tamanho_key: Number(r.tamanho_key),
    tamanho_venda: r.tamanho_venda == null ? "" : String(r.tamanho_venda).trim(),
    desc_produto: trimOrNull(r.desc_produto),
    cor_descricao_linx: trimOrNull(r.cor_descricao_linx),
  };
}

const skuKey = (r) => JSON.stringify([r.produto, r.cor_codigo, r.tamanho_key]);

/**
 * Collapses rows with the same barcode AND the same SKU (harmless Linx
 * duplicates) and separates barcodes that map to DIFFERENT SKUs. Ambiguous
 * barcodes are never published — no arbitrary SKU is picked; they come back in
 * `ambiguous` so the caller can warn and persist the count.
 */
export function resolveBarcodeAmbiguity(rows) {
  const bySku = new Map(); // codigo_barra -> Map(skuKey -> row)
  let duplicateRows = 0;

  for (const r of rows) {
    let skus = bySku.get(r.codigo_barra);
    if (!skus) {
      skus = new Map();
      bySku.set(r.codigo_barra, skus);
    }
    const k = skuKey(r);
    if (skus.has(k)) duplicateRows += 1;
    else skus.set(k, r);
  }

  const kept = [];
  const ambiguous = [];
  for (const [codigo, skus] of bySku) {
    if (skus.size === 1) {
      kept.push(skus.values().next().value);
    } else {
      ambiguous.push({
        codigo_barra: codigo,
        skus: [...skus.values()].map((s) => ({
          produto: s.produto,
          cor_codigo: s.cor_codigo,
          tamanho_key: s.tamanho_key,
        })),
      });
    }
  }
  return { rows: kept, ambiguous, duplicateRows };
}

/**
 * Drops rows that can never be a valid published barcode (blank/oversized
 * code, blank SKU key, tamanho_key outside 1..48, blank label). These are
 * source noise, reported as warnings — they do not block the run.
 */
export function normalizeBarcodeExtraction(rows) {
  const kept = [];
  const warnings = [];
  for (const r of rows) {
    const invalid =
      !r.codigo_barra ||
      r.codigo_barra.length > MAX_BARCODE_LENGTH ||
      !r.produto ||
      !r.cor_codigo ||
      !Number.isInteger(r.tamanho_key) ||
      r.tamanho_key < 1 ||
      r.tamanho_key > 48 ||
      !r.tamanho_venda;
    if (invalid) {
      warnings.push(
        `Excluded invalid barcode row: codigo_barra="${r.codigo_barra}" produto="${r.produto}" ` +
          `cor_codigo="${r.cor_codigo}" tamanho_key=${r.tamanho_key}`,
      );
      continue;
    }
    kept.push(r);
  }
  return { rows: kept, warnings };
}

export function buildBarcodeMap(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.codigo_barra, r);
  return map;
}

/**
 * Classifies incoming barcodes against the current estoque_barcodes state:
 *   novo       - not in current
 *   alterado   - in both, any content field differs (e.g. barcode re-pointed to
 *                another SKU, or its label/description changed)
 *   removido   - in current, not incoming (inactivated / no longer carried /
 *                now ambiguous) -> stale mapping deleted
 *   inalterado - identical
 */
export function diffBarcodes(incomingMap, currentMap) {
  const novo = [];
  const alterado = [];
  const removido = [];
  let inalterado = 0;

  for (const [key, incoming] of incomingMap) {
    const current = currentMap.get(key);
    if (!current) {
      novo.push(incoming);
    } else if (CONTENT_FIELDS.some((f) => (current[f] ?? null) !== (incoming[f] ?? null))) {
      alterado.push(incoming);
    } else {
      inalterado += 1;
    }
  }

  for (const key of currentMap.keys()) {
    if (!incomingMap.has(key)) removido.push({ codigo_barra: key });
  }

  return { novo, alterado, removido, inalterado };
}
