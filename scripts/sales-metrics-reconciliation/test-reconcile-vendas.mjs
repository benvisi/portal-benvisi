#!/usr/bin/env node
// =============================================================================
// Salesperson Metrics — dry-run reconciliation — offline unit tests
//
//   node scripts/sales-metrics-reconciliation/test-reconcile-vendas.mjs
//
// Pure fixture tests for the classification/KPI/anomaly logic in
// reconcile-vendas.mjs. No Linx/Supabase connection — deterministic, safe to
// re-run any time. Keep this alongside the tool and re-run after any change
// to the KPI/anomaly logic.
// =============================================================================

import {
  assertReadOnlyQuery,
  buildReport,
  classifyTicket,
  computeKpis,
  detectDuplicateCanonicalKeys,
  groupBySalesperson,
  parseArgs,
} from "./reconcile-vendas.mjs";

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

function row(overrides) {
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
console.log("classifyTicket");
{
  const valid = classifyTicket(row({}));
  check("valid, non-cancelled ticket -> isValid=true", valid.isValid === true);
  check("resolves cleanly -> isResolved=true", valid.isResolved === true);
  check("not a zero-attribution anomaly", valid.isZeroAttribution === false);
  check("not a multi-attribution anomaly", valid.isMultiAttribution === false);

  const cancelled = classifyTicket(row({ data_hora_cancelamento: new Date("2026-09-02T00:00:00Z") }));
  check("cancelled ticket -> isValid=false", cancelled.isValid === false);
  check("cancelled ticket -> isCancelled=true", cancelled.isCancelled === true);

  const zeroAttr = classifyTicket(row({ vendedores_distintos: 0, vendedor_codigo: null }));
  check("zero attribution -> isZeroAttribution=true", zeroAttr.isZeroAttribution === true);
  check("zero attribution -> isResolved=false", zeroAttr.isResolved === false);

  const multiAttr = classifyTicket(row({ vendedores_distintos: 2, vendedor_codigo: null }));
  check("multi attribution -> isMultiAttribution=true", multiAttr.isMultiAttribution === true);
  check("multi attribution -> isResolved=false", multiAttr.isResolved === false);
}

// ---------------------------------------------------------------------------
console.log("\ndetectDuplicateCanonicalKeys");
{
  const unique = [row({ ticket: "A" }), row({ ticket: "B" })].map(classifyTicket);
  const dupUnique = detectDuplicateCanonicalKeys(unique);
  check("no duplicates -> duplicateKeyCount=0", dupUnique.duplicateKeyCount === 0);
  check("canonicalKeyCount=2 for 2 distinct tickets", dupUnique.canonicalKeyCount === 2);

  const withDup = [row({ ticket: "A" }), row({ ticket: "A" }), row({ ticket: "B" })].map(classifyTicket);
  const dupResult = detectDuplicateCanonicalKeys(withDup);
  check("one duplicated key detected", dupResult.duplicateKeyCount === 1, JSON.stringify(dupResult));
  check("3 total rows, 2 of them in the duplicate group", dupResult.duplicateRowCount === 2);
  check("canonicalKeyCount counts distinct keys, not rows", dupResult.canonicalKeyCount === 2);
}

// ---------------------------------------------------------------------------
console.log("\ncomputeKpis");
{
  const rows = [
    row({ valor_pago: 100, qtde_total: 2, qtde_troca_total: 0 }),
    row({ valor_pago: 200, qtde_total: 3, qtde_troca_total: 1 }),
  ];
  const kpis = computeKpis(rows);
  check("vendaLiquida sums valor_pago", kpis.vendaLiquida === 300, String(kpis.vendaLiquida));
  check("tickets counts rows", kpis.tickets === 2);
  check("pecasBrutas sums qtde_total", kpis.pecasBrutas === 5);
  check("pecasTroca sums qtde_troca_total", kpis.pecasTroca === 1);
  check("pecasLiquidas = brutas - troca", kpis.pecasLiquidas === 4);
  check("ticketMedio = vendaLiquida / tickets", kpis.ticketMedio === 150);
  check("pa = pecasLiquidas / tickets", kpis.pa === 2);
  check("pm = vendaLiquida / pecasLiquidas", kpis.pm === 75);

  const empty = computeKpis([]);
  check("zero tickets -> ticketMedio is null, not 0", empty.ticketMedio === null);
  check("zero tickets -> pa is null, not 0", empty.pa === null);
  check("zero tickets -> pm is null, not 0 (pecasLiquidas=0 too)", empty.pm === null);

  const zeroPieces = computeKpis([row({ valor_pago: 50, qtde_total: 1, qtde_troca_total: 1 })]);
  check(
    "pecasLiquidas=0 (all trocas) -> pm is null, not a divide-by-zero artifact",
    zeroPieces.pecasLiquidas === 0 && zeroPieces.pm === null,
  );
}

// ---------------------------------------------------------------------------
console.log("\ngroupBySalesperson");
{
  const rows = [
    row({ ticket: "A", vendedor_codigo: "4642", valor_pago: 100 }),
    row({ ticket: "B", vendedor_codigo: "4642", valor_pago: 50 }),
    row({ ticket: "C", vendedor_codigo: "3778", valor_pago: 300 }),
    // anomalous tickets must NEVER be force-attributed to any salesperson:
    row({ ticket: "D", vendedores_distintos: 0, vendedor_codigo: null }),
    row({ ticket: "E", vendedores_distintos: 2, vendedor_codigo: null }),
  ].map(classifyTicket);

  const grouped = groupBySalesperson(rows);
  check("groups into exactly 2 salespeople", grouped.length === 2, String(grouped.length));
  check("sorted by vendaLiquida descending", grouped[0].vendedorCodigo === "3778");
  check("4642's bucket sums both of their tickets", grouped[1].kpis.vendaLiquida === 150);
  check(
    "anomalous tickets excluded from every bucket (total tickets across groups = 3, not 5)",
    grouped.reduce((n, g) => n + g.kpis.tickets, 0) === 3,
  );
}

// ---------------------------------------------------------------------------
console.log("\nbuildReport");
{
  const rawRows = [
    row({ ticket: "A", vendedor_codigo: "4642", valor_pago: 100 }),
    row({ ticket: "B", data_hora_cancelamento: new Date("2026-09-05T00:00:00Z") }),
    row({ ticket: "C", vendedores_distintos: 0, vendedor_codigo: null }),
    row({ ticket: "D", vendedores_distintos: 2, vendedor_codigo: null }),
  ];
  const report = buildReport(rawRows, { filial: "060420", start: "2026-09-01", end: "2026-09-30" });

  check("totalRowsExamined = 4", report.totalRowsExamined === 4);
  check("canonicalTicketCount = 4 (all distinct tickets)", report.canonicalTicketCount === 4);
  check("cancelledTicketCount = 1", report.cancelledTicketCount === 1);
  check("validTicketCount = 3", report.validTicketCount === 3);
  check("zeroAttributionCount = 1", report.zeroAttributionCount === 1);
  check("multiAttributionCount = 1", report.multiAttributionCount === 1);
  check(
    "validUnattributedCount = 2 (the zero- and multi-attribution tickets are both still valid)",
    report.validUnattributedCount === 2,
  );
  check(
    "overall KPIs count all 3 valid tickets regardless of attribution (store-level, Power-BI-comparable)",
    report.overallKpis.tickets === 3,
  );
  check(
    "perSalesperson only contains the one cleanly-resolved ticket",
    report.perSalesperson.length === 1 && report.perSalesperson[0].kpis.tickets === 1,
  );

  const dupRawRows = [row({ ticket: "A" }), row({ ticket: "A" })];
  const dupReport = buildReport(dupRawRows, { filial: "060420", start: "2026-09-01", end: "2026-09-30" });
  check(
    "duplicate canonical key surfaces in the report, not silently merged",
    dupReport.duplicateCanonicalKeyCount === 1 && dupReport.duplicateRowCount === 2,
  );
}

// ---------------------------------------------------------------------------
console.log("\nassertReadOnlyQuery");
{
  let threwOnSelect = false;
  try {
    assertReadOnlyQuery("SELECT * FROM dbo.LOJA_VENDA WHERE CODIGO_FILIAL = @filial");
  } catch {
    threwOnSelect = true;
  }
  check("a plain SELECT is accepted", threwOnSelect === false);

  for (const bad of [
    "INSERT INTO dbo.LOJA_VENDA VALUES (1)",
    "UPDATE dbo.LOJA_VENDA SET VALOR_PAGO = 0",
    "DELETE FROM dbo.LOJA_VENDA",
    "DROP TABLE dbo.LOJA_VENDA",
    "EXEC sp_who",
  ]) {
    let threw = false;
    try {
      assertReadOnlyQuery(bad);
    } catch {
      threw = true;
    }
    check(`rejects mutating statement: ${bad.split(" ")[0]}`, threw === true);
  }
}

// ---------------------------------------------------------------------------
console.log("\nparseArgs");
{
  const args = parseArgs(["--start", "2026-09-01", "--end", "2026-09-30"]);
  check("default filial is 060420 when --filial omitted", args.filial === "060420");
  check("start/end echoed back as given", args.start === "2026-09-01" && args.end === "2026-09-30");
  check(
    "endDateExclusive is one day past the inclusive --end",
    args.endDateExclusive.toISOString().slice(0, 10) === "2026-10-01",
  );

  let threwMissingStart = false;
  try {
    parseArgs(["--end", "2026-09-30"]);
  } catch {
    threwMissingStart = true;
  }
  check("missing --start throws", threwMissingStart === true);

  let threwBadRange = false;
  try {
    parseArgs(["--start", "2026-09-30", "--end", "2026-09-01"]);
  } catch {
    threwBadRange = true;
  }
  check("--end before --start throws", threwBadRange === true);

  const custom = parseArgs(["--filial", "060421", "--start", "2026-01-01", "--end", "2026-01-01"]);
  check("--filial overrides the 060420 default", custom.filial === "060421");
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
