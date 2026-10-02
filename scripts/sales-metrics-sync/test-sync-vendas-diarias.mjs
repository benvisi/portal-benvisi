#!/usr/bin/env node
// =============================================================================
// Salesperson Metrics Portal V1 — Slice A sync — offline unit tests
//
//   node scripts/sales-metrics-sync/test-sync-vendas-diarias.mjs
//
// Pure fixture tests for this script's own logic (date windowing, CLI
// parsing, mapping resolution, and the Total/Outros residual math this
// script previews before writing). The underlying classification/KPI/
// anomaly logic is already covered by
// scripts/sales-metrics-reconciliation/test-reconcile-vendas.mjs — this
// file does not re-test it, only the code added in this slice. No
// Linx/Supabase connection — deterministic, safe to re-run any time.
// =============================================================================

import {
  classifyTicket,
  computeKpis,
  detectDuplicateCanonicalKeys,
  groupBySalesperson,
} from "../sales-metrics-reconciliation/reconcile-vendas.mjs";

import {
  buildMappingIndex,
  computeRatios,
  defaultSyncDates,
  hasNonZeroResidual,
  manausDateString,
  parseArgs,
  resolveMappedRows,
  sumAdditive,
  sumKpis,
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

// A raw Linx row exactly as linx-vendas-query.sql produces it. VENDEDOR
// codes are text (CHAR(4) on the live schema — e.g. "4642"), never numbers.
function linxRow(overrides) {
  return {
    codigo_filial: "060420",
    ticket: "T1",
    data_venda: new Date("2026-09-01T00:00:00Z"),
    valor_pago: 100,
    qtde_total: 2,
    qtde_troca_total: 0,
    data_hora_cancelamento: null,
    vendedores_distintos: 1,
    vendedor_codigo: "4642",
    vendedor_nome: "FULANO DA SILVA",
    vendedor_apelido: "FULANO",
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
console.log("buildMappingIndex / resolveMappedRows (text VENDEDOR codes)");
{
  const mapa = buildMappingIndex([
    { funcionario_id: "aaa-funcionario", codigo_vendedor_linx: "4642", nome: "FULANO DA SILVA" },
    {
      funcionario_id: "bbb-funcionario",
      codigo_vendedor_linx: "0012",
      nome: "COM ZERO A ESQUERDA",
    },
  ]);
  check(
    "buildMappingIndex keys by text codigo_vendedor_linx",
    mapa.get("4642")?.funcionarioId === "aaa-funcionario",
  );
  check(
    "buildMappingIndex preserves a leading-zero code exactly (never coerced to a number)",
    mapa.get("0012")?.funcionarioId === "bbb-funcionario" && !mapa.has("12"),
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
    "mapped row keeps codigo_vendedor_linx as text",
    mapeadas[0].codigo_vendedor_linx === "4642",
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

  const { mapeadas: mapeadasZero } = resolveMappedRows(
    [salesperson({ vendedorCodigo: "0012", vendedorNome: "COM ZERO A ESQUERDA" })],
    mapa,
  );
  check(
    "a leading-zero vendedor code maps correctly (not silently dropped as a number)",
    mapeadasZero.length === 1 && mapeadasZero[0].funcionario_id === "bbb-funcionario",
  );
}

// ---------------------------------------------------------------------------
console.log("sumKpis / sumAdditive / hasNonZeroResidual / computeRatios");
{
  const summed = sumKpis([
    salesperson({}),
    salesperson({
      kpis: {
        ...salesperson({}).kpis,
        vendaLiquida: 500,
        tickets: 5,
        pecasBrutas: 8,
        pecasTroca: 1,
      },
    }),
  ]);
  check(
    "sumKpis sums the additive ingredients across entries",
    summed.vendaLiquida === 1500 && summed.tickets === 15,
  );
  check("sumKpis output has no ratio fields", !("ticketMedio" in summed));

  const zero = { vendaLiquida: 0, tickets: 0, pecasBrutas: 0, pecasTroca: 0 };
  const nonzero = { vendaLiquida: 50, tickets: 0, pecasBrutas: 0, pecasTroca: 0 };
  check("hasNonZeroResidual is false for an all-zero residual", hasNonZeroResidual(zero) === false);
  check(
    "hasNonZeroResidual is true when even one field is nonzero",
    hasNonZeroResidual(nonzero) === true,
  );

  const ratios = computeRatios({ vendaLiquida: 100, tickets: 2, pecasBrutas: 5, pecasTroca: 1 });
  check("computeRatios: pecasLiquidas = pecasBrutas - pecasTroca", ratios.pecasLiquidas === 4);
  check("computeRatios: ticketMedio = vendaLiquida / tickets", ratios.ticketMedio === 50);
  check("computeRatios: pa = pecasLiquidas / tickets", ratios.pa === 2);
  check("computeRatios: pm = vendaLiquida / pecasLiquidas", ratios.pm === 25);

  const zeroTicketsRatios = computeRatios({
    vendaLiquida: 0,
    tickets: 0,
    pecasBrutas: 0,
    pecasTroca: 0,
  });
  check(
    "computeRatios: ticketMedio is null (not 0) when tickets = 0",
    zeroTicketsRatios.ticketMedio === null,
  );
  check("computeRatios: pa is null (not 0) when tickets = 0", zeroTicketsRatios.pa === null);

  const zeroPecasRatios = computeRatios({
    vendaLiquida: 100,
    tickets: 3,
    pecasBrutas: 2,
    pecasTroca: 2,
  });
  check("computeRatios: pm is null (not 0) when pecasLiquidas = 0", zeroPecasRatios.pm === null);
}

// ---------------------------------------------------------------------------
console.log("end-to-end: Total / Outros residual invariant over a realistic mixed day");
{
  // One day's raw Linx extraction covering every case this slice must
  // handle distinctly: a cleanly mapped salesperson (two tickets), a
  // zero-attribution ticket, a multi-attribution ticket, a resolved ticket
  // whose vendedor has no funcionarios mapping, and a cancelled ticket
  // (which must be excluded from everything, including Total).
  const rawRows = [
    linxRow({
      ticket: "T1",
      vendedor_codigo: "4642",
      valor_pago: 300,
      qtde_total: 3,
      qtde_troca_total: 0,
    }),
    linxRow({
      ticket: "T2",
      vendedor_codigo: "4642",
      valor_pago: 200,
      qtde_total: 2,
      qtde_troca_total: 1,
    }),
    linxRow({
      ticket: "T3",
      vendedores_distintos: 0,
      vendedor_codigo: null,
      vendedor_nome: null,
      vendedor_apelido: null,
      valor_pago: 50,
      qtde_total: 1,
      qtde_troca_total: 0,
    }),
    linxRow({
      ticket: "T4",
      vendedores_distintos: 2,
      vendedor_codigo: null,
      vendedor_nome: null,
      vendedor_apelido: null,
      valor_pago: 70,
      qtde_total: 1,
      qtde_troca_total: 0,
    }),
    linxRow({
      ticket: "T5",
      vendedor_codigo: "9999",
      vendedor_nome: "SEM FUNCIONARIO",
      vendedor_apelido: "SEM FUNCIONARIO",
      valor_pago: 40,
      qtde_total: 1,
      qtde_troca_total: 0,
    }),
    linxRow({
      ticket: "T6",
      vendedor_codigo: "4642",
      valor_pago: 999,
      qtde_total: 9,
      qtde_troca_total: 0,
      data_hora_cancelamento: new Date("2026-09-01T18:00:00Z"),
    }),
  ];

  const classified = rawRows.map(classifyTicket);
  const dup = detectDuplicateCanonicalKeys(classified);
  check("fixture has no duplicate canonical keys", dup.duplicateKeyCount === 0);

  const validRows = classified.filter((r) => r.isValid);
  check("the cancelled ticket (T6) is excluded from valid rows", validRows.length === 5);

  const zeroRows = validRows.filter((r) => r.isZeroAttribution);
  const multiRows = validRows.filter((r) => r.isMultiAttribution);
  check("exactly one zero-attribution ticket (T3)", zeroRows.length === 1);
  check("exactly one multi-attribution ticket (T4)", multiRows.length === 1);

  const mapa = buildMappingIndex([
    { funcionario_id: "func-4642", codigo_vendedor_linx: "4642", nome: "FULANO DA SILVA" },
  ]);
  const perSalesperson = groupBySalesperson(validRows);
  const { mapeadas, naoMapeadas } = resolveMappedRows(perSalesperson, mapa);

  check(
    "mapped salesperson group covers only T1+T2 (4642)",
    mapeadas.length === 1 && mapeadas[0].tickets === 2,
  );
  check(
    "mapped salesperson venda_liquida = 300 + 200 (T6 excluded as cancelled)",
    mapeadas[0].venda_liquida === 500,
  );
  check(
    "unmapped vendedor group covers T5 (9999)",
    naoMapeadas.length === 1 && naoMapeadas[0].vendedorCodigo === "9999",
  );

  const totalLojaKpis = computeKpis(validRows);
  const zeroKpis = computeKpis(zeroRows);
  const multiKpis = computeKpis(multiRows);
  const naoMapeadasKpis = sumKpis(naoMapeadas);

  check(
    "store Total (overallKpis over ALL valid rows) = 300+200+50+70+40, NOT merely the mapped sum",
    totalLojaKpis.vendaLiquida === 660 && totalLojaKpis.tickets === 5,
  );

  const outros = sumAdditive([zeroKpis, multiKpis, naoMapeadasKpis]);
  check("Outros residual = zero(50) + multi(70) + unmapped(40) = 160", outros.vendaLiquida === 160);
  check("Outros residual ticket count = 1 + 1 + 1 = 3", outros.tickets === 3);
  check(
    "Outros residual is nonzero for this fixture (Outros row would be shown)",
    hasNonZeroResidual(outros) === true,
  );

  // The core invariant this slice must guarantee:
  //   sum(displayed salesperson rows) + Outros = Total
  check(
    "INVARIANT: sum(mapped salesperson venda_liquida) + Outros.venda_liquida = Total.venda_liquida",
    mapeadas[0].venda_liquida + outros.vendaLiquida === totalLojaKpis.vendaLiquida,
  );
  check(
    "INVARIANT: sum(mapped salesperson tickets) + Outros.tickets = Total.tickets",
    mapeadas[0].tickets + outros.tickets === totalLojaKpis.tickets,
  );
  check(
    "INVARIANT: sum(mapped salesperson pecas_brutas) + Outros.pecasBrutas = Total.pecasBrutas",
    mapeadas[0].pecas_brutas + outros.pecasBrutas === totalLojaKpis.pecasBrutas,
  );
  check(
    "INVARIANT: sum(mapped salesperson pecas_troca) + Outros.pecasTroca = Total.pecasTroca",
    mapeadas[0].pecas_troca + outros.pecasTroca === totalLojaKpis.pecasTroca,
  );
  const mapedPecasLiquidas = mapeadas[0].pecas_brutas - mapeadas[0].pecas_troca;
  const outrosRatios = computeRatios(outros);
  check(
    "INVARIANT: sum(mapped pecas_liquidas) + Outros.pecasLiquidas = Total.pecasLiquidas",
    mapedPecasLiquidas + outrosRatios.pecasLiquidas === totalLojaKpis.pecasLiquidas,
  );

  check("Outros ticket médio = 160 / 3", Math.abs(outrosRatios.ticketMedio - 160 / 3) < 1e-9);
  check("Outros PA = pecasLiquidas / tickets", outrosRatios.pa === outrosRatios.pecasLiquidas / 3);
  check(
    "Outros PM = vendaLiquida / pecasLiquidas",
    outrosRatios.pecasLiquidas === 0
      ? outrosRatios.pm === null
      : outrosRatios.pm === 160 / outrosRatios.pecasLiquidas,
  );
}

// ---------------------------------------------------------------------------
console.log("end-to-end: an all-clean day omits Outros (residual is exactly zero)");
{
  const rawRows = [
    linxRow({
      ticket: "T1",
      vendedor_codigo: "4642",
      valor_pago: 300,
      qtde_total: 3,
      qtde_troca_total: 0,
    }),
    linxRow({
      ticket: "T2",
      vendedor_codigo: "5614",
      valor_pago: 150,
      qtde_total: 1,
      qtde_troca_total: 0,
    }),
  ];
  const classified = rawRows.map(classifyTicket);
  const validRows = classified.filter((r) => r.isValid);
  const zeroRows = validRows.filter((r) => r.isZeroAttribution);
  const multiRows = validRows.filter((r) => r.isMultiAttribution);

  const mapa = buildMappingIndex([
    { funcionario_id: "func-4642", codigo_vendedor_linx: "4642", nome: "FULANO" },
    { funcionario_id: "func-5614", codigo_vendedor_linx: "5614", nome: "CICLANO" },
  ]);
  const perSalesperson = groupBySalesperson(validRows);
  const { mapeadas, naoMapeadas } = resolveMappedRows(perSalesperson, mapa);

  const totalLojaKpis = computeKpis(validRows);
  const zeroKpis = computeKpis(zeroRows);
  const multiKpis = computeKpis(multiRows);
  const naoMapeadasKpis = sumKpis(naoMapeadas);
  const outros = sumAdditive([zeroKpis, multiKpis, naoMapeadasKpis]);

  check(
    "both tickets map cleanly (no unmapped/zero/multi)",
    mapeadas.length === 2 && naoMapeadas.length === 0,
  );
  check(
    "Outros residual is exactly zero on an all-clean day",
    hasNonZeroResidual(outros) === false,
  );
  check(
    "sum(mapped) alone already equals Total when residual is zero",
    mapeadas.reduce((acc, m) => acc + m.venda_liquida, 0) === totalLojaKpis.vendaLiquida,
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
