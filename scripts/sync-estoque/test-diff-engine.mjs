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
import { normalizeExtraction, finalizeCanonicalRow } from "./sync-estoque.mjs";

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

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
