// =============================================================================
// Consulta de Estoque — Price V1 — price current-state diff engine
// =============================================================================
// Price grain is produto + cor_codigo only (no size dimension — price never
// varies by size), so unlike estoque-hash.mjs this needs no content hash: a
// group's entire "content" is one numeric value, compared directly.
//
// Reuses groupKey from estoque-hash.mjs so the map key format is identical
// everywhere in the sync (see that module's comment on the real bug a
// mismatched separator caused during V2 QA).
// =============================================================================

import { groupKey } from "./estoque-hash.mjs";

/** produto/cor_codigo -> { produto, cor_codigo, preco } map from finalized rows. */
export function buildPriceMap(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(groupKey(r.produto, r.cor_codigo), {
      produto: r.produto,
      cor_codigo: r.cor_codigo,
      preco: r.preco,
    });
  }
  return map;
}

/**
 * Classifies every incoming price group against the current price state
 * (produced by fetchCurrentPrices in sync-estoque.mjs), mirroring diffGroups'
 * novo/alterado/removido/inalterado shape:
 *
 *   novo       - in incoming, not in current            -> stage + insert
 *   alterado   - in both, preco differs                 -> stage + replace
 *   removido   - in current, not in incoming             -> delete only
 *   inalterado - in both, preco equal                    -> no write
 */
export function diffPrices(incomingMap, currentMap) {
  const novo = [];
  const alterado = [];
  const removido = [];
  let inalterado = 0;

  for (const [key, incoming] of incomingMap) {
    const current = currentMap.get(key);
    if (!current) {
      novo.push(incoming);
    } else if (Number(current.preco) !== Number(incoming.preco)) {
      alterado.push(incoming);
    } else {
      inalterado += 1;
    }
  }

  for (const [key, current] of currentMap) {
    if (!incomingMap.has(key)) {
      removido.push({ produto: current.produto, cor_codigo: current.cor_codigo });
    }
  }

  return { novo, alterado, removido, inalterado };
}

/**
 * Trims produto/cor_codigo and coerces preco to a number. Runs on every raw
 * price row before normalization/validation, mirroring finalizeCanonicalRow's
 * role for inventory rows.
 */
export function finalizePriceRow(r) {
  return {
    produto: String(r.produto).trim(),
    cor_codigo: String(r.cor_codigo).trim(),
    preco: Number(r.preco),
  };
}

/**
 * Excludes rows that can never correspond to a real inventory produto+cor
 * group, so they are dropped rather than blocking the whole run:
 *
 *   - blank produto/cor_codigo — R3 carries a handful of placeholder rows
 *     with an entirely blank COR_PRODUTO (verified live, 2026-09-14: 4 such
 *     rows, three of them priced at 1). No Manaus inventory group can ever
 *     have a blank cor_codigo, so these can never match anything; they are
 *     R3 table noise, not a Portal data-integrity problem.
 *   - non-positive prices (locked decision: R3 carries PRECO1 = 0 for
 *     produto/cor combinations not currently stocked in Manaus — never a
 *     real retail price — see linx-price-query.sql).
 *
 * A price row is dropped, never coerced to some other value; the affected
 * produto/cor is then reported as "missing price" downstream, same as if R3
 * had no row at all. Content-based, no hard-coded produto/cor list,
 * mirroring normalizeExtraction's dash-only placeholder handling for
 * inventory.
 */
export function normalizePriceExtraction(rows) {
  const kept = [];
  const warnings = [];
  let excludedBlankKey = 0;
  let excludedNonPositive = 0;

  for (const r of rows) {
    if (!r.produto || !r.cor_codigo) {
      excludedBlankKey += 1;
      warnings.push(
        `Excluded R3 row with a blank produto/cor_codigo (never matches a real inventory group): ` +
          `produto="${r.produto}" cor_codigo="${r.cor_codigo}" preco=${r.preco}`,
      );
      continue;
    }
    if (!Number.isFinite(r.preco) || r.preco <= 0) {
      excludedNonPositive += 1;
      warnings.push(
        `Excluded non-positive R3 price (treated as missing): produto=${r.produto} ` +
          `cor_codigo=${r.cor_codigo} preco=${r.preco}`,
      );
      continue;
    }
    kept.push(r);
  }

  return { rows: kept, excludedBlankKey, excludedNonPositive, warnings };
}

/**
 * Local validation of the (already finalized + normalized) price rows.
 * Duplicate (produto, cor_codigo) is a FATAL problem, not a normalization
 * case — R3 is expected to be unique per produto+cor (verified live,
 * 2026-09-14); a duplicate appearing would mean the Linx extraction or the
 * table itself changed in a way this sync was never validated against, so
 * the run must stop rather than silently pick one value.
 */
export function validatePriceExtraction(rows) {
  const problems = [];
  if (rows.length === 0) problems.push("price extraction returned 0 rows");

  const seen = new Set();
  let dupKeys = 0;
  let missingKeys = 0;

  for (const r of rows) {
    if (!r.produto || !r.cor_codigo) missingKeys += 1;
    const key = groupKey(r.produto, r.cor_codigo);
    if (seen.has(key)) dupKeys += 1;
    else seen.add(key);
  }

  if (missingKeys) problems.push(`${missingKeys} price row(s) with an empty produto/cor_codigo`);
  if (dupKeys)
    problems.push(
      `${dupKeys} duplicate (produto, cor_codigo) price row(s) — R3 is expected to be unique per produto+cor`,
    );

  return {
    ok: problems.length === 0,
    problems,
    stats: { linhas: rows.length, produto_cores: seen.size },
  };
}
