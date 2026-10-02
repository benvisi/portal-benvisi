#!/usr/bin/env node
// =============================================================================
// Consulta de Estoque — Sync V2 — diff engine backend QA
//
//   node scripts/sync-estoque/test-diff-engine.mjs
//
// Pure Node fixture tests for estoque-hash.mjs (group hashing/diff) and the
// normalize/finalize pipeline in sync-estoque.mjs. No Supabase/Linx
// connection — this is offline, deterministic, and safe to re-run any time.
// Not a throwaway diagnostic script: keep it, re-run it after any change to
// the hash/diff/normalize logic.
// =============================================================================

import { hashAllGroups, diffGroups, hashGroup, groupKey } from "./estoque-hash.mjs";
import {
  normalizeExtraction,
  finalizeCanonicalRow,
  normalizeNegativeQuantities,
  validateExtraction,
} from "./sync-estoque.mjs";
import {
  buildPriceMap,
  diffPrices,
  finalizePriceRow,
  normalizePriceExtraction,
  validatePriceExtraction,
} from "./estoque-price-diff.mjs";

let failures = 0;
let passed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(produto, corCodigo, overrides, rows) {
  const base = {
    produto,
    desc_produto: "DESC PADRAO",
    tipo_produto: "TIPO",
    linha: "LINHA",
    grade: "G01",
    cor_codigo: corCodigo,
    cor_descricao_linx: "MARINE",
    ...overrides,
  };
  return rows.map((r) => ({ ...base, ...r }));
}

// Baseline "current" state: two groups.
const GROUP_A_ROWS = group("PH4012", "23", {}, [
  { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 2 },
  { tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: 0 },
]);
const GROUP_B_ROWS = group(
  "RK0342",
  "23",
  {
    desc_produto: "CALCA",
    tipo_produto: "CALCA",
    linha: "DENIM",
    grade: "G02",
    cor_descricao_linx: "NOIR",
  },
  [{ tamanho_key: 1, tamanho_venda: "38", quantidade_estoque: 5 }],
);

function currentHashesFrom(rows) {
  const hashed = hashAllGroups(rows);
  const map = new Map();
  for (const [key, g] of hashed) {
    map.set(key, {
      produto: g.produto,
      cor_codigo: g.cor_codigo,
      hash_conteudo: g.hash,
      row_count: g.row_count,
    });
  }
  return map;
}

console.log("estoque-hash.mjs / diff engine");

// 1. zero change
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const incoming = hashAllGroups([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const diff = diffGroups(incoming, current);
  check(
    "zero change -> no novo/alterado/removido, 2 inalterado",
    diff.novo.length === 0 &&
      diff.alterado.length === 0 &&
      diff.removido.length === 0 &&
      diff.inalterado === 2,
    JSON.stringify(diff.novo.concat(diff.alterado).concat(diff.removido)) +
      ` inalterado=${diff.inalterado}`,
  );
}

// 2. one quantity changed
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const changedA = group("PH4012", "23", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 2 },
    { tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: 3 }, // 0 -> 3
  ]);
  const incoming = hashAllGroups([...changedA, ...GROUP_B_ROWS]);
  const diff = diffGroups(incoming, current);
  check(
    "quantity change -> A alterado, B inalterado",
    diff.alterado.length === 1 && diff.alterado[0].produto === "PH4012" && diff.inalterado === 1,
  );
}

// 3. one size added
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const addedA = group("PH4012", "23", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 2 },
    { tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: 0 },
    { tamanho_key: 3, tamanho_venda: "G", quantidade_estoque: 1 },
  ]);
  const incoming = hashAllGroups([...addedA, ...GROUP_B_ROWS]);
  const diff = diffGroups(incoming, current);
  check(
    "size added -> A alterado with row_count 3",
    diff.alterado.length === 1 && diff.alterado[0].row_count === 3,
  );
}

// 4. one size removed
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const shrunkA = group("PH4012", "23", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 2 },
  ]);
  const incoming = hashAllGroups([...shrunkA, ...GROUP_B_ROWS]);
  const diff = diffGroups(incoming, current);
  check(
    "size removed -> A alterado with row_count 1",
    diff.alterado.length === 1 && diff.alterado[0].row_count === 1,
  );
}

// 5. one new group
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const groupC = group("MH9088", "23", { desc_produto: "JAQUETA" }, [
    { tamanho_key: 1, tamanho_venda: "U", quantidade_estoque: 4 },
  ]);
  const incoming = hashAllGroups([...GROUP_A_ROWS, ...GROUP_B_ROWS, ...groupC]);
  const diff = diffGroups(incoming, current);
  check(
    "new group -> C novo, A+B inalterado",
    diff.novo.length === 1 && diff.novo[0].produto === "MH9088" && diff.inalterado === 2,
  );
}

// 6. one removed group
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const incoming = hashAllGroups([...GROUP_A_ROWS]); // B entirely absent
  const diff = diffGroups(incoming, current);
  check(
    "removed group -> B removido, A inalterado",
    diff.removido.length === 1 &&
      diff.removido[0].produto === "RK0342" &&
      diff.removido[0].cor_codigo === "23" &&
      diff.inalterado === 1,
  );
}

// 7. metadata change (desc_produto) with identical size rows
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const renamedA = group("PH4012", "23", { desc_produto: "CAMISA POLO REVISADA" }, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 2 },
    { tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: 0 },
  ]);
  const incoming = hashAllGroups([...renamedA, ...GROUP_B_ROWS]);
  const diff = diffGroups(incoming, current);
  check(
    "metadata-only change (desc_produto) -> A alterado",
    diff.alterado.length === 1 && diff.alterado[0].produto === "PH4012",
  );
}

// 8. source color description change (cor_descricao_linx) counts as changed
{
  const current = currentHashesFrom([...GROUP_A_ROWS, ...GROUP_B_ROWS]);
  const recoloredA = group("PH4012", "23", { cor_descricao_linx: "MARINE FONCE" }, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 2 },
    { tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: 0 },
  ]);
  const incoming = hashAllGroups([...recoloredA, ...GROUP_B_ROWS]);
  const diff = diffGroups(incoming, current);
  check(
    "cor_descricao_linx change -> A alterado (source metadata, not friendly mapping)",
    diff.alterado.length === 1 && diff.alterado[0].produto === "PH4012",
  );
}

// 9. friendly color mapping fields (cor_nome_portal/cor_familia), even if
//    present on the row object, must NOT affect the hash.
{
  const plain = hashGroup({ produto: "PH4012", cor_codigo: "23", rows: GROUP_A_ROWS });
  const withFriendlyFields = hashGroup({
    produto: "PH4012",
    cor_codigo: "23",
    rows: GROUP_A_ROWS.map((r) => ({ ...r, cor_nome_portal: "Azul-marinho", cor_familia: "Azul" })),
  });
  const withDifferentFriendlyFields = hashGroup({
    produto: "PH4012",
    cor_codigo: "23",
    rows: GROUP_A_ROWS.map((r) => ({
      ...r,
      cor_nome_portal: "Outro Nome Qualquer",
      cor_familia: "Outra Familia",
    })),
  });
  check(
    "cor_nome_portal / cor_familia never affect the hash",
    plain === withFriendlyFields && withFriendlyFields === withDifferentFriendlyFields,
  );
}

// 10. row input order does not affect the hash
{
  const forward = hashGroup({ produto: "PH4012", cor_codigo: "23", rows: GROUP_A_ROWS });
  const reversed = hashGroup({
    produto: "PH4012",
    cor_codigo: "23",
    rows: [...GROUP_A_ROWS].reverse(),
  });
  check("row input order does not affect the hash", forward === reversed);
}

// 11 & 12. dash-only placeholder handling (normalizeExtraction, unchanged
//          from V1, exercised here for regression safety).
{
  const rows = [
    {
      produto: "U00LC1",
      cor_codigo: "001",
      tamanho_key: 1,
      tamanho_venda: "-",
      quantidade_estoque: 0,
    },
    {
      produto: "U00LC1",
      cor_codigo: "001",
      tamanho_key: 2,
      tamanho_venda: "--",
      quantidade_estoque: 3,
    },
    {
      produto: "U00LC1",
      cor_codigo: "001",
      tamanho_key: 3,
      tamanho_venda: "ONE",
      quantidade_estoque: 5,
    },
  ];
  const norm = normalizeExtraction(rows);
  check(
    "dash-only + qty=0 -> excluded from canonical rows",
    norm.excludedDashZero === 1 && !norm.rows.some((r) => r.tamanho_key === 1),
  );
  check(
    "dash-only + qty!=0 -> retained with a warning",
    norm.rows.some((r) => r.tamanho_key === 2) && norm.warnings.length === 1,
  );
  check(
    "non-dash label unaffected",
    norm.rows.some((r) => r.tamanho_key === 3),
  );
}

// groupKey sanity — used as the Map key throughout the diff engine.
{
  check(
    "groupKey is stable and distinguishes produto/cor pairs",
    groupKey("PH4012", "23") === groupKey("PH4012", "23") &&
      groupKey("PH4012", "23") !== groupKey("PH4012", "24"),
  );
}

// finalizeCanonicalRow: mojibake repair + trimming, used ahead of hashing.
{
  const finalized = finalizeCanonicalRow({
    produto: " PH4012 ",
    desc_produto: "PARKAS & BLUSÃ•ES",
    tipo_produto: null,
    linha: "  ",
    cor_codigo: " 23 ",
    cor_descricao_linx: " MARINE ",
    grade: "G01",
    tamanho_key: "1",
    tamanho_venda: " P ",
    quantidade_estoque: "2",
  });
  check(
    "finalizeCanonicalRow trims produto/cor_codigo",
    finalized.produto === "PH4012" && finalized.cor_codigo === "23",
  );
  check(
    "finalizeCanonicalRow repairs mojibake in desc_produto",
    finalized.desc_produto === "PARKAS & BLUSÕES",
    finalized.desc_produto,
  );
  check(
    "finalizeCanonicalRow coerces tamanho_key/quantidade_estoque to numbers",
    finalized.tamanho_key === 1 && finalized.quantidade_estoque === 2,
  );
}

console.log("\nestoque-price-diff.mjs (Price V1)");

// 13. zero change -> everything inalterado
{
  const current = buildPriceMap([
    { produto: "TH6709-23", cor_codigo: "001", preco: 429 },
    { produto: "TH6709-23", cor_codigo: "QPT", preco: 399 },
  ]);
  const incoming = buildPriceMap([
    { produto: "TH6709-23", cor_codigo: "001", preco: 429 },
    { produto: "TH6709-23", cor_codigo: "QPT", preco: 399 },
  ]);
  const diff = diffPrices(incoming, current);
  check(
    "zero price change -> no novo/alterado/removido, 2 inalterado",
    diff.novo.length === 0 &&
      diff.alterado.length === 0 &&
      diff.removido.length === 0 &&
      diff.inalterado === 2,
  );
}

// 14. price-only change (quantities untouched by this engine) -> alterado
{
  const current = buildPriceMap([{ produto: "TH6709-23", cor_codigo: "001", preco: 429 }]);
  const incoming = buildPriceMap([{ produto: "TH6709-23", cor_codigo: "001", preco: 449 }]);
  const diff = diffPrices(incoming, current);
  check(
    "price change -> alterado, carries the NEW preco",
    diff.alterado.length === 1 && diff.alterado[0].preco === 449,
  );
}

// 15. new produto+cor price -> novo
{
  const current = buildPriceMap([{ produto: "TH6709-23", cor_codigo: "001", preco: 429 }]);
  const incoming = buildPriceMap([
    { produto: "TH6709-23", cor_codigo: "001", preco: 429 },
    { produto: "TH6709-23", cor_codigo: "031", preco: 429 },
  ]);
  const diff = diffPrices(incoming, current);
  check(
    "new produto+cor -> novo, existing inalterado",
    diff.novo.length === 1 && diff.novo[0].cor_codigo === "031" && diff.inalterado === 1,
  );
}

// 16. produto+cor price gone from R3 -> removido
{
  const current = buildPriceMap([
    { produto: "TH6709-23", cor_codigo: "001", preco: 429 },
    { produto: "TH6709-23", cor_codigo: "031", preco: 429 },
  ]);
  const incoming = buildPriceMap([{ produto: "TH6709-23", cor_codigo: "001", preco: 429 }]);
  const diff = diffPrices(incoming, current);
  check(
    "price no longer in R3 -> removido, other inalterado",
    diff.removido.length === 1 &&
      diff.removido[0].produto === "TH6709-23" &&
      diff.removido[0].cor_codigo === "031" &&
      diff.inalterado === 1,
  );
}

// 17. non-positive PRECO1 (0 or negative) is excluded, never invented
{
  const rows = [
    { produto: "TH6709-23", cor_codigo: "001", preco: 429 },
    { produto: "ABC1234-99", cor_codigo: "LVH", preco: 0 },
  ].map((r) => finalizePriceRow(r));
  const norm = normalizePriceExtraction(rows);
  check(
    "PRECO1 = 0 -> excluded, treated as missing (never shown as R$ 0)",
    norm.excludedNonPositive === 1 && norm.rows.length === 1 && norm.rows[0].cor_codigo === "001",
  );
  check("exclusion is warned", norm.warnings.length === 1);
}

// 17b. blank cor_codigo (R3 placeholder rows, verified live 2026-09-14) is
//      excluded — it can never match a real inventory group.
{
  const rows = [
    { produto: "TH6709-23", cor_codigo: "001", preco: 429 },
    { produto: "15SPM1611", cor_codigo: "", preco: 1 },
  ].map((r) => finalizePriceRow(r));
  const norm = normalizePriceExtraction(rows);
  check(
    "blank cor_codigo -> excluded, never blocks the run",
    norm.excludedBlankKey === 1 && norm.rows.length === 1 && norm.rows[0].cor_codigo === "001",
  );
}

// 18. duplicate (produto, cor_codigo) in R3 is FATAL, not silently deduped
{
  const rows = [
    { produto: "TH6709-23", cor_codigo: "001", preco: 429 },
    { produto: "TH6709-23", cor_codigo: "001", preco: 449 },
  ];
  const v = validatePriceExtraction(rows);
  check(
    "duplicate (produto, cor_codigo) price row -> validation fails",
    !v.ok && v.problems.some((p) => p.includes("duplicate")),
  );
}

// 19. empty extraction is FATAL (same rule as inventory's own zero-row abort)
{
  const v = validatePriceExtraction([]);
  check(
    "zero price rows -> validation fails",
    !v.ok && v.problems.some((p) => p.includes("0 rows")),
  );
}

// 20. finalizePriceRow trims and coerces preco to a number
{
  const finalized = finalizePriceRow({
    produto: " TH6709-23 ",
    cor_codigo: " 001 ",
    preco: "429.00",
  });
  check(
    "finalizePriceRow trims produto/cor_codigo and coerces preco",
    finalized.produto === "TH6709-23" && finalized.cor_codigo === "001" && finalized.preco === 429,
  );
}

// 21. buildPriceMap uses the same groupKey format as estoque-hash.mjs
{
  const map = buildPriceMap([{ produto: "TH6709-23", cor_codigo: "001", preco: 429 }]);
  check(
    "buildPriceMap key matches groupKey(produto, cor_codigo)",
    map.has(groupKey("TH6709-23", "001")),
  );
}

// ---------------------------------------------------------------------------
// 22-28. normalizeNegativeQuantities / validateExtraction — negative
// size-level quantity handling (locked decision, 2026-10-02). Confirmed
// production case: produto CH2932-23 / cor_codigo 2QB / tamanho_key 1,
// quantidade_estoque -1, aggregate Linx ESTOQUE 3.
// ---------------------------------------------------------------------------

// 22. a negative quantity is normalized to 0
{
  const rows = group("CH2932", "2QB", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: -1 },
  ]).map(finalizeCanonicalRow);
  const result = normalizeNegativeQuantities(rows);
  check(
    "negative quantidade_estoque (-1) normalized to 0",
    result.rows[0].quantidade_estoque === 0,
    `got ${result.rows[0].quantidade_estoque}`,
  );
  check("only the negative field changes, other row fields untouched", result.rows[0].produto === "CH2932" && result.rows[0].cor_codigo === "2QB" && result.rows[0].tamanho_key === 1);
}

// 23. normalization is counted and emits one warning identifying the row
{
  const rows = group("CH2932", "2QB", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: -1 },
  ]).map(finalizeCanonicalRow);
  const result = normalizeNegativeQuantities(rows);
  check("negativeNormalizedCount = 1", result.negativeNormalizedCount === 1);
  check("exactly one warning emitted", result.warnings.length === 1);
  const w = result.warnings[0] || "";
  check(
    "warning identifies produto, cor_codigo, tamanho_key, original value, and normalized value",
    w.includes("produto=CH2932") &&
      w.includes("cor_codigo=2QB") &&
      w.includes("tamanho_key=1") &&
      w.includes("quantidade_estoque_original=-1") &&
      w.includes("quantidade_estoque_normalizada=0"),
    w,
  );
}

// 24. multiple negative rows are each normalized, counted, and warned about
{
  const rows = group("CH2932", "2QB", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: -1 },
    { tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: -3 },
    { tamanho_key: 3, tamanho_venda: "G", quantidade_estoque: 5 },
  ]).map(finalizeCanonicalRow);
  const result = normalizeNegativeQuantities(rows);
  check("negativeNormalizedCount = 2 (only the two negative rows)", result.negativeNormalizedCount === 2);
  check("one warning per negative row", result.warnings.length === 2);
  check(
    "both negative rows normalized to 0, positive row untouched",
    result.rows[0].quantidade_estoque === 0 &&
      result.rows[1].quantidade_estoque === 0 &&
      result.rows[2].quantidade_estoque === 5,
  );
}

// 25. zero and positive quantities pass through unchanged, no warnings, no count
{
  const rows = group("PH4012", "23", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 0 },
    { tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: 7 },
  ]).map(finalizeCanonicalRow);
  const result = normalizeNegativeQuantities(rows);
  check("negativeNormalizedCount = 0 when nothing is negative", result.negativeNormalizedCount === 0);
  check("no warnings when nothing is negative", result.warnings.length === 0);
  check(
    "zero and positive quantities are byte-for-byte unchanged",
    result.rows[0].quantidade_estoque === 0 && result.rows[1].quantidade_estoque === 7,
  );
}

// 26. end-to-end: a negative quantity no longer makes validateExtraction fatal
// once normalizeNegativeQuantities has run first (the real sync's own order)
{
  const rows = group("CH2932", "2QB", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: -1 },
  ]).map(finalizeCanonicalRow);
  const normalized = normalizeNegativeQuantities(rows).rows;
  const v = validateExtraction(normalized);
  check(
    "validateExtraction PASSES after upstream negative normalization",
    v.ok === true,
    JSON.stringify(v.problems),
  );
  check("tamanhos_negativos stat reads 0 post-normalization", v.stats.tamanhos_negativos === 0);
}

// 27. existing validation protections are unchanged: duplicate canonical key
// is still fatal, independent of the negative-quantity change
{
  const rows = group("PH4012", "23", {}, [
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 1 },
    { tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 2 },
  ]).map(finalizeCanonicalRow);
  const v = validateExtraction(normalizeNegativeQuantities(rows).rows);
  check(
    "duplicate (produto, cor_codigo, tamanho_key) is still fatal",
    !v.ok && v.problems.some((p) => p.includes("duplicate")),
  );
}

// 28. existing validation protections are unchanged: a blank tamanho_venda
// label is still fatal, independent of the negative-quantity change
{
  const rows = group("PH4012", "23", {}, [
    { tamanho_key: 1, tamanho_venda: "", quantidade_estoque: 1 },
  ]).map(finalizeCanonicalRow);
  const v = validateExtraction(normalizeNegativeQuantities(rows).rows);
  check(
    "blank tamanho_venda is still fatal",
    !v.ok && v.problems.some((p) => p.includes("tamanho_venda")),
  );
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
