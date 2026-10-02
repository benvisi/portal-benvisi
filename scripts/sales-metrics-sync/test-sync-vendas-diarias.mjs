#!/usr/bin/env node
// =============================================================================
// Salesperson Metrics Portal V1 — Slice A sync — offline unit tests
//
//   node scripts/sales-metrics-sync/test-sync-vendas-diarias.mjs
//
// Pure fixture tests for this script's own logic (date windowing, CLI
// parsing, mapping resolution). The underlying classification/KPI/anomaly
// logic is already covered by
// scripts/sales-metrics-reconciliation/test-reconcile-vendas.mjs — this file
// does not re-test it, only the code added in this slice. No Linx/Supabase
// connection — deterministic, safe to re-run any time.
// =============================================================================

import {
  buildMappingIndex,
  defaultSyncDates,
  manausDateString,
  parseArgs,
  resolveMappedRows,
} from "./sync-vendas-diarias.mjs";

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

function salesperson(overrides) {
  return {
    vendedorCodigo: "4642",
    vendedorNome: "FULANO DA SILVA",
    vendedorApelido: "FULANO",
    kpis: {
      vendaLiquida: 1000,
      tickets: 10,
      pecasBrutas: 20,
      pecasTroca: 2,
      pecasLiquidas: 18,
      ticketMedio: 100,
      pa: 1.8,
      pm: 55.56,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("manausDateString / defaultSyncDates");
{
  // 2026-01-15T03:00:00Z is 2026-01-14T23:00:00-04:00 in Manaus (fixed UTC-4,
  // no DST) — crosses midnight, a good check that the timezone conversion
  // (not just a UTC slice) is actually applied.
  const utcEarlyMorning = new Date("2026-01-15T03:00:00Z");
  check(
    "manausDateString rolls back to the previous Manaus calendar day",
    manausDateString(utcEarlyMorning) === "2026-01-14",
    manausDateString(utcEarlyMorning),
  );

  const noonUtc = new Date("2026-01-15T16:00:00Z");
  check(
    "manausDateString matches the same Manaus calendar day at local midday",
    manausDateString(noonUtc) === "2026-01-15",
    manausDateString(noonUtc),
  );

  const [yesterday, today] = defaultSyncDates(noonUtc);
  check(
    "defaultSyncDates returns [yesterday, today]",
    yesterday === "2026-01-14" && today === "2026-01-15",
  );
}

// ---------------------------------------------------------------------------
console.log("parseArgs");
{
  const now = new Date("2026-01-15T16:00:00Z");

  const defaults = parseArgs([], { now });
  check("defaults to no --dry-run", defaults.dryRun === false);
  check("defaults to filial 060420", defaults.filial === "060420");
  check(
    "defaults to [yesterday, today] when --dates omitted",
    JSON.stringify(defaults.dates) === JSON.stringify(["2026-01-14", "2026-01-15"]),
  );

  const dryRun = parseArgs(["--dry-run"], { now });
  check("--dry-run sets dryRun=true", dryRun.dryRun === true);

  const customFilial = parseArgs(["--filial", "060421"], { now });
  check("--filial overrides the default", customFilial.filial === "060421");

  const customDates = parseArgs(["--dates", "2026-09-01,2026-09-02"], { now });
  check(
    "--dates overrides the default window",
    JSON.stringify(customDates.dates) === JSON.stringify(["2026-09-01", "2026-09-02"]),
  );

  let threw = false;
  try {
    parseArgs(["--dates", "not-a-date"], { now });
  } catch {
    threw = true;
  }
  check("--dates rejects a malformed date", threw);
}

// ---------------------------------------------------------------------------
console.log("buildMappingIndex / resolveMappedRows");
{
  const mapa = buildMappingIndex([
    { funcionario_id: "aaa-funcionario", codigo_vendedor_linx: 4642, nome: "FULANO DA SILVA" },
    { funcionario_id: "bbb-funcionario", codigo_vendedor_linx: 9999, nome: "OUTRO VENDEDOR" },
  ]);
  check(
    "buildMappingIndex keys by numeric codigo_vendedor_linx",
    mapa.get(4642)?.funcionarioId === "aaa-funcionario",
  );
  check("buildMappingIndex ignores null codigo_vendedor_linx rows", mapa.size === 2);

  const { mapeadas, naoMapeadas } = resolveMappedRows(
    [salesperson({}), salesperson({ vendedorCodigo: "7777", vendedorNome: "SEM MAPA" })],
    mapa,
  );
  check("resolveMappedRows maps the known vendedor code", mapeadas.length === 1);
  check(
    "mapped row carries the resolved funcionario_id",
    mapeadas[0].funcionario_id === "aaa-funcionario",
  );
  check(
    "mapped row carries the additive KPI ingredients, not the ratios",
    mapeadas[0].venda_liquida === 1000 && mapeadas[0].tickets === 10,
  );
  check("mapped row has no ticket_medio/pa/pm fields", !("ticketMedio" in mapeadas[0]));
  check(
    "resolveMappedRows reports the unmapped vendedor code separately",
    naoMapeadas.length === 1,
  );
  check("unmapped entry is never force-mapped", naoMapeadas[0].vendedorCodigo === "7777");
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
