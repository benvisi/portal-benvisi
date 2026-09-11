// =============================================================================
// Consulta de Estoque — Sync V2 — deterministic group hashing / diff engine
// =============================================================================
// Node is the SOLE hash producer (V2 architecture, section 4) — PostgreSQL
// never recomputes this serialization; estoque_aplicar_sync trusts whatever
// hash this module supplies and stores it verbatim alongside the group rows
// it was computed from, in the same transaction.
//
// Input rows here are expected to already be the fully finalized canonical
// row shape (see finalizeCanonicalRow in sync-estoque.mjs): normalized
// (dash-only placeholders excluded), mojibake-repaired, trimmed, numeric
// fields coerced. This module does not re-normalize anything.
//
// Deliberately excluded from the hash: cor_nome_portal / cor_familia (V2
// brief section 20 - curated read-time enrichment, never inventory content),
// any database id, any timestamp, any sync_id.
// =============================================================================

import { createHash } from "node:crypto";

// Stable key for a produto+cor_codigo group. Built with JSON.stringify of a
// 2-tuple rather than a hand-picked delimiter string, and this is the ONE
// place a group key is ever constructed - every caller (grouping, diffing,
// and the estoque_atual_grupos lookup in sync-estoque.mjs) imports and uses
// this exact function rather than re-deriving the same format independently.
// That discipline exists because of a real bug caught during V2 QA: an
// inline template literal elsewhere used a different (and, it turned out,
// not actually reproducible-by-eye) separator character, so every lookup
// missed even for byte-identical produto/cor_codigo values, misclassifying
// every unchanged group as simultaneously new and removed.
export function groupKey(produto, corCodigo) {
  return JSON.stringify([produto, corCodigo]);
}

/**
 * Groups canonical rows by produto+cor_codigo. Row input order never matters
 * downstream - canonicalizeGroup re-sorts every group's rows by tamanho_key
 * before hashing.
 */
export function groupByProdutoCor(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = groupKey(r.produto, r.cor_codigo);
    let g = groups.get(key);
    if (!g) {
      g = { produto: r.produto, cor_codigo: r.cor_codigo, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  return groups;
}

/**
 * Canonical JSON value for one group: group-level fields first (produto,
 * cor_codigo, desc_produto, tipo_produto, linha, grade, cor_descricao_linx -
 * every Linx-derived field that can affect Portal inventory content), then
 * member rows sorted by tamanho_key ascending as [tamanho_key, tamanho_venda,
 * quantidade_estoque] tuples. `null` is preserved as JSON null everywhere -
 * never coalesced to '' - so NULL and '' can never hash identically.
 */
export function canonicalizeGroup(group) {
  const first = group.rows[0];
  const sortedRows = [...group.rows]
    .sort((a, b) => Number(a.tamanho_key) - Number(b.tamanho_key))
    .map((r) => [
      Number(r.tamanho_key),
      r.tamanho_venda == null ? null : String(r.tamanho_venda),
      Number(r.quantidade_estoque),
    ]);

  return [
    group.produto,
    group.cor_codigo,
    first.desc_produto == null ? null : String(first.desc_produto),
    first.tipo_produto == null ? null : String(first.tipo_produto),
    first.linha == null ? null : String(first.linha),
    first.grade == null ? null : String(first.grade),
    first.cor_descricao_linx == null ? null : String(first.cor_descricao_linx),
    sortedRows,
  ];
}

/** SHA-256 hex digest of the canonical JSON serialization of a group. */
export function hashGroup(group) {
  const json = JSON.stringify(canonicalizeGroup(group));
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * Full incoming-extraction group map, keyed by groupKey(produto,cor_codigo),
 * each entry carrying { produto, cor_codigo, rows, hash, row_count }.
 */
export function hashAllGroups(rows) {
  const grouped = groupByProdutoCor(rows);
  const result = new Map();
  for (const [key, group] of grouped) {
    result.set(key, {
      produto: group.produto,
      cor_codigo: group.cor_codigo,
      rows: group.rows,
      hash: hashGroup(group),
      row_count: group.rows.length,
    });
  }
  return result;
}

/**
 * Classifies every group exactly once against the compact current-state hash
 * map (groupKey -> { produto, cor_codigo, hash_conteudo, row_count }) read
 * from estoque_atual_grupos.
 *
 *   novo       - in incoming, not in current            -> stage + insert
 *   alterado   - in both, hash differs                  -> stage + replace
 *   removido   - in current, not in incoming             -> delete only
 *   inalterado - in both, hash equal                     -> no write (count only)
 */
export function diffGroups(incomingGroups, currentHashes) {
  const novo = [];
  const alterado = [];
  const removido = [];
  let inalterado = 0;

  for (const [key, incoming] of incomingGroups) {
    const current = currentHashes.get(key);
    if (!current) {
      novo.push(incoming);
    } else if (current.hash_conteudo !== incoming.hash) {
      alterado.push(incoming);
    } else {
      inalterado += 1;
    }
  }

  for (const [key, current] of currentHashes) {
    if (!incomingGroups.has(key)) {
      removido.push({ produto: current.produto, cor_codigo: current.cor_codigo });
    }
  }

  return { novo, alterado, removido, inalterado };
}
