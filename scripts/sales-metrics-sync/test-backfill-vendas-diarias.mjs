#!/usr/bin/env node
// =============================================================================
// Historical backfill — offline unit tests
//
//   node scripts/sales-metrics-sync/test-backfill-vendas-diarias.mjs
//
// Covers the backfill's own logic (argument validation, month batching,
// per-day grouping, unmapped accumulation) plus an end-to-end fixture that
// feeds a month of ticket rows through the SAME processDayRows() the daily
// sync uses, against a fake Supabase client — no Linx/Supabase connection.
// =============================================================================

import {
  accumulateUnmapped,
  addDays,
  groupRowsByDate,
  monthBatches,
  parseBackfillArgs,
} from "./backfill-vendas-diarias.mjs";
import { buildMappingIndex, processDayRows } from "./sync-vendas-diarias.mjs";

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

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const NOW = new Date("2026-11-02T21:00:00Z"); // 17:00 in Manaus
const parse = (argv) => parseBackfillArgs(argv, { now: NOW });

// ---------------------------------------------------------------------------
console.log("\nparseBackfillArgs");
{
  const ok = parse(["--from", "2023-01-01", "--to", "2026-11-02", "--dry-run"]);
  check(
    "accepts an explicit range, default filial, dry-run flag",
    ok.from === "2023-01-01" && ok.to === "2026-11-02" && ok.filial === "060420" && ok.dryRun,
  );
  check(
    "real run when --dry-run absent",
    parse(["--from", "2023-01-01", "--to", "2023-01-31"]).dryRun === false,
  );
  check(
    "requires --from and --to",
    throws(() => parse(["--from", "2023-01-01"])),
  );
  check(
    "rejects non-dates",
    throws(() => parse(["--from", "2023-02-30", "--to", "2023-03-01"])),
  );
  check(
    "rejects from > to",
    throws(() => parse(["--from", "2023-03-02", "--to", "2023-03-01"])),
  );
  check(
    "rejects a future --to (Manaus today)",
    throws(() => parse(["--from", "2026-11-01", "--to", "2026-11-03"])),
  );
  // 01:00 UTC on Nov 3 is still Nov 2 in Manaus.
  const lateUtc = new Date("2026-11-03T01:00:00Z");
  check(
    "--to uses the Manaus date, not UTC",
    parseBackfillArgs(["--from", "2026-11-01", "--to", "2026-11-02"], { now: lateUtc }).to ===
      "2026-11-02",
  );
}

// ---------------------------------------------------------------------------
console.log("\nmonthBatches");
{
  const b = monthBatches("2023-01-01", "2026-11-02");
  check("2023-01 .. 2026-11 = 47 monthly batches", b.length === 47, `got ${b.length}`);
  check(
    "first batch is all of January 2023",
    b[0].start === "2023-01-01" && b[0].end === "2023-01-31" && b[0].endExclusive === "2023-02-01",
  );
  check(
    "last batch is clipped to --to",
    b[46].start === "2026-11-01" &&
      b[46].end === "2026-11-02" &&
      b[46].endExclusive === "2026-11-03",
  );
  const leap = monthBatches("2024-02-10", "2024-03-05");
  check(
    "clips the first batch to --from and handles leap February",
    leap[0].start === "2024-02-10" &&
      leap[0].end === "2024-02-29" &&
      leap[1].start === "2024-03-01" &&
      leap[1].end === "2024-03-05",
  );
  check(
    "batches are contiguous with no gaps or overlaps",
    b.every((x, i) => i === 0 || x.start === addDays(b[i - 1].end, 1)),
  );
  const single = monthBatches("2026-11-02", "2026-11-02");
  check(
    "single-day range = one one-day batch",
    single.length === 1 && single[0].endExclusive === "2026-11-03",
  );
}

// ---------------------------------------------------------------------------
console.log("\ngroupRowsByDate");
{
  const rows = [
    { data_venda: new Date("2026-10-02T00:00:00Z"), ticket: 3 },
    { data_venda: new Date("2026-10-01T00:00:00Z"), ticket: 1 },
    { data_venda: "2026-10-01", ticket: 2 },
  ];
  const g = groupRowsByDate(rows);
  check(
    "groups by day, ascending, Date or string",
    [...g.keys()].join() === "2026-10-01,2026-10-02" && g.get("2026-10-01").length === 2,
  );
}

// ---------------------------------------------------------------------------
console.log("\naccumulateUnmapped");
{
  const acc = new Map();
  const sp = (codigo, tickets, venda) => ({
    vendedorCodigo: ` ${codigo} `,
    vendedorNome: "X",
    kpis: { tickets, vendaLiquida: venda },
  });
  accumulateUnmapped(acc, "2023-01-01", [sp("0042", 2, 100)]);
  accumulateUnmapped(acc, "2023-01-02", [sp("0042", 1, 50.5)]);
  const u = acc.get("0042");
  check(
    "totals per trimmed text code across days (leading zero kept)",
    u && u.dias.size === 2 && u.tickets === 3 && u.vendaLiquida === 150.5,
  );
}

// ---------------------------------------------------------------------------
console.log("\nend-to-end fixture: a month of tickets through processDayRows");
{
  const ticket = (n, dia, valor, qtde, troca, vendedores, codigo, cancel = null) => ({
    codigo_filial: "060420",
    ticket: String(n),
    data_venda: new Date(`2023-01-${dia}T00:00:00Z`),
    valor_pago: valor,
    qtde_total: qtde,
    qtde_troca_total: troca,
    data_hora_cancelamento: cancel,
    vendedores_distintos: vendedores,
    vendedor_codigo: codigo,
    vendedor_nome: codigo ? `NOME ${codigo}` : null,
    vendedor_apelido: codigo ? `AP${codigo}` : null,
  });
  const raw = [
    ticket(1, "02", 100, 2, 0, 1, "0001"),
    ticket(2, "02", 200, 3, 1, 1, "0001"),
    ticket(3, "02", 50, 1, 0, 1, "0777"), // unmapped code
    ticket(4, "02", 70, 1, 0, 0, null), // zero attribution
    ticket(5, "02", 999, 9, 0, 1, "0001", new Date()), // cancelled
    ticket(6, "03", 300, 4, 0, 2, null), // multi attribution
    ticket(7, "03", 40, 1, 0, 1, "0001"),
  ];
  const mapa = buildMappingIndex([
    { codigo_vendedor_linx: "0001", funcionario_id: "f-1", nome: "Um" },
  ]);

  const calls = [];
  const fakeSupabase = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return {
        data: [
          {
            vendedores_inseridos: payload.p_linhas_vendedores.length,
            vendedores_removidos: 0,
            loja_gravada: true,
            anomalias_inseridas: 3,
          },
        ],
        error: null,
      };
    },
  };

  const byDate = groupRowsByDate(raw);
  const results = [];
  for (const [dateStr, rows] of byDate) {
    results.push(
      await processDayRows(fakeSupabase, mapa, {
        filial: "060420",
        dateStr,
        dryRun: false,
        rawRows: rows,
      }),
    );
  }

  check(
    "one write RPC per day with data (2), all to vendas_diarias_substituir_dia",
    calls.length === 2 && calls.every((c) => c.name === "vendas_diarias_substituir_dia"),
  );
  const d2 = calls.find((c) => c.payload.p_data_venda === "2023-01-02").payload;
  check(
    "Jan 2: Total counts every valid ticket (cancelled excluded)",
    d2.p_total_loja.venda_liquida === 420 &&
      d2.p_total_loja.tickets === 4 &&
      d2.p_total_loja.pecas_brutas === 7 &&
      d2.p_total_loja.pecas_troca === 1,
  );
  check(
    "Jan 2: only the mapped vendedor is a salesperson row",
    d2.p_linhas_vendedores.length === 1 &&
      d2.p_linhas_vendedores[0].funcionario_id === "f-1" &&
      d2.p_linhas_vendedores[0].venda_liquida === 300,
  );
  const d3 = calls.find((c) => c.payload.p_data_venda === "2023-01-03").payload;
  check(
    "Jan 3: multi-attribution ticket stays in Total, not in a salesperson row",
    d3.p_total_loja.venda_liquida === 340 && d3.p_linhas_vendedores[0].venda_liquida === 40,
  );
  const unmappedDay2 = results.find((r) => r.dateStr === "2023-01-02").naoMapeadas;
  check(
    "unmapped code surfaced for the end-of-run summary",
    unmappedDay2.length === 1 && unmappedDay2[0].vendedorCodigo === "0777",
  );

  // Idempotency: replaying the same day sends an identical full-replacement payload.
  const before = JSON.stringify(calls[0].payload);
  await processDayRows(fakeSupabase, mapa, {
    filial: "060420",
    dateStr: "2023-01-02",
    dryRun: false,
    rawRows: byDate.get("2023-01-02"),
  });
  check(
    "rerunning a day sends the identical replace payload (idempotent)",
    JSON.stringify(calls[2].payload) === before,
  );

  const dry = [];
  await processDayRows({ rpc: async (n) => dry.push(n) }, mapa, {
    filial: "060420",
    dateStr: "2023-01-02",
    dryRun: true,
    rawRows: byDate.get("2023-01-02"),
  });
  check("dry-run never calls the write RPC", dry.length === 0);
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
