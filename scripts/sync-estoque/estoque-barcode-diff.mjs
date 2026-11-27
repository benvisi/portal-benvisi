// =============================================================================
// Consulta de Estoque — Barcode Slice 1 — barcode mapping engine
// =============================================================================
// Grain: codigo_barra (text, leading zeros preserved — never coerced to a
// number). Pipeline: finalize -> normalize (drop invalid / placeholder rows) ->
// resolve ambiguity -> mapping hash -> (only when the hash changed) diff
// against the current estoque_barcodes state.
//
// Independent of the inventory group hash: barcode reconciliation runs on its
// own cadence (barcodeCheckDue) and quantity-only inventory changes never
// trigger it.
// =============================================================================

import { createHash } from "node:crypto";

const MAX_BARCODE_LENGTH = 64;
const MAX_DETAILED_WARNINGS = 50;

// Weekly reconciliation boundary: Monday 00:00 in the store's local time, so
// the first hourly run of the week (always before the store opens) performs
// it — or the first available run after that if the machine was off.
export const BARCODE_TIMEZONE = "America/Manaus";

// Fields compared to decide "alterado" and hashed into the mapping hash.
// Everything the table stores besides the key and sync metadata.
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

const identity = (v) => v;

/**
 * Trims text fields and coerces tamanho_key; codigo_barra stays a string.
 * `repairText` is the same mojibake repair the inventory applies to
 * desc_produto (passed in to avoid a circular import).
 */
export function finalizeBarcodeRow(r, repairText = identity) {
  const desc = trimOrNull(r.desc_produto);
  return {
    codigo_barra: r.codigo_barra == null ? "" : String(r.codigo_barra).trim(),
    produto: r.produto == null ? "" : String(r.produto).trim(),
    cor_codigo: r.cor_codigo == null ? "" : String(r.cor_codigo).trim(),
    tamanho_key: Number(r.tamanho_key),
    tamanho_venda: r.tamanho_venda == null ? "" : String(r.tamanho_venda).trim(),
    desc_produto: desc == null ? null : repairText(desc),
    cor_descricao_linx: trimOrNull(r.cor_descricao_linx),
  };
}

const skuKey = (r) => JSON.stringify([r.produto, r.cor_codigo, r.tamanho_key]);

function pushCapped(warnings, state, message) {
  state.count += 1;
  if (state.count <= MAX_DETAILED_WARNINGS) warnings.push(message);
}

/**
 * Drops rows that can never be a valid published barcode, reported as
 * warnings (they never block the run):
 *   - blank/oversized code, blank SKU key, tamanho_key outside 1..48, blank label
 *   - dash-only placeholder size labels ("-", "--", ...). They are structural
 *     grade placeholders (same content rule as the inventory normalization),
 *     not sellable sizes, so no barcode is published for them.
 */
export function normalizeBarcodeExtraction(rows) {
  const kept = [];
  const warnings = [];
  const invalid = { count: 0 };
  let excludedPlaceholder = 0;

  for (const r of rows) {
    const bad =
      !r.codigo_barra ||
      r.codigo_barra.length > MAX_BARCODE_LENGTH ||
      !r.produto ||
      !r.cor_codigo ||
      !Number.isInteger(r.tamanho_key) ||
      r.tamanho_key < 1 ||
      r.tamanho_key > 48 ||
      !r.tamanho_venda;
    if (bad) {
      pushCapped(
        warnings,
        invalid,
        `Excluded invalid barcode row: codigo_barra="${r.codigo_barra}" produto="${r.produto}" ` +
          `cor_codigo="${r.cor_codigo}" tamanho_key=${r.tamanho_key}`,
      );
      continue;
    }
    if (/^-+$/.test(r.tamanho_venda)) {
      excludedPlaceholder += 1;
      continue;
    }
    kept.push(r);
  }

  if (invalid.count > MAX_DETAILED_WARNINGS) {
    warnings.push(
      `... ${invalid.count - MAX_DETAILED_WARNINGS} more invalid barcode row(s) excluded`,
    );
  }
  if (excludedPlaceholder > 0) {
    warnings.push(
      `Excluded ${excludedPlaceholder} barcode row(s) pointing at a dash-only placeholder size`,
    );
  }
  return { rows: kept, warnings, invalidCount: invalid.count, excludedPlaceholder };
}

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

/** Audit warnings for excluded ambiguous barcodes (capped, with a total). */
export function ambiguityWarnings(ambiguous) {
  const warnings = ambiguous
    .slice(0, MAX_DETAILED_WARNINGS)
    .map(
      (a) =>
        `Ambiguous barcode EXCLUDED (maps to ${a.skus.length} different SKUs): ` +
        `codigo_barra=${a.codigo_barra} skus=${JSON.stringify(a.skus)}`,
    );
  if (ambiguous.length > MAX_DETAILED_WARNINGS) {
    warnings.push(
      `... ${ambiguous.length - MAX_DETAILED_WARNINGS} more ambiguous barcode(s) excluded ` +
        `(${ambiguous.length} in total)`,
    );
  }
  return warnings;
}

export function buildBarcodeMap(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.codigo_barra, r);
  return map;
}

/**
 * Deterministic SHA-256 of the complete normalized mapping: entries sorted by
 * codigo_barra (code-unit order), each serialized as
 * [codigo_barra, produto, cor_codigo, tamanho_key, tamanho_venda,
 *  desc_produto, cor_descricao_linx]. No timestamps or sync metadata, so the
 * same Linx mapping always yields the same hash. Blank descriptions hash as
 * null (same equivalence the diff uses).
 */
export function hashBarcodeMapping(map) {
  const keys = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries = keys.map((k) => {
    const r = map.get(k);
    return [
      r.codigo_barra,
      r.produto,
      r.cor_codigo,
      Number(r.tamanho_key),
      r.tamanho_venda,
      trimOrNull(r.desc_produto),
      trimOrNull(r.cor_descricao_linx),
    ];
  });
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
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
    } else if (
      CONTENT_FIELDS.some((f) => {
        const a = typeof current[f] === "string" ? trimOrNull(current[f]) : (current[f] ?? null);
        const b = typeof incoming[f] === "string" ? trimOrNull(incoming[f]) : (incoming[f] ?? null);
        return a !== b;
      })
    ) {
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

// -----------------------------------------------------------------------------
// Cadence
// -----------------------------------------------------------------------------

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday,
  };
}

/**
 * Most recent Monday 00:00 (store local time) at or before `now`, as a Date.
 */
export function weeklyBarcodeBoundary(now, timeZone = BARCODE_TIMEZONE) {
  const p = zonedParts(now, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const daysSinceMonday = (p.weekday + 6) % 7;
  const mondayLocalMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day - daysSinceMonday);
  return new Date(mondayLocalMidnightAsUtc - offsetMs);
}

/**
 * Decides whether this run performs a barcode check, and why. Reasons:
 *   manual            --force-barcode-check (bypasses cadence, not guards)
 *   inicial           nothing published yet (or the published hash was
 *                     cleared after detected drift)
 *   retry             the previous required check failed or was blocked
 *   semanal           no successful check since this week's Monday boundary
 *   novo_produto_cor  inventory gained a produto+cor with no mapped barcode
 * `estado` is the row from estoque_barcode_estado() (null = unknown).
 */
export function barcodeCheckDue({ estado, now, force = false, unmappedNewPairs = 0 }) {
  const motivos = [];
  if (force) motivos.push("manual");
  if (!estado || !estado.hash_publicado) motivos.push("inicial");
  if (estado?.check_pendente) motivos.push("retry");
  const boundary = weeklyBarcodeBoundary(now);
  if (estado?.hash_publicado) {
    const lastOk = estado.ultimo_check_ok_em ? new Date(estado.ultimo_check_ok_em) : null;
    if (!lastOk || lastOk < boundary) motivos.push("semanal");
  }
  if (unmappedNewPairs > 0) motivos.push("novo_produto_cor");
  return { due: motivos.length > 0, motivos, boundary };
}
