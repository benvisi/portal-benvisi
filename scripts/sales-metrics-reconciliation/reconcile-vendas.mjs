#!/usr/bin/env node
// =============================================================================
// Salesperson Metrics — Dry-run Linx reconciliation (READ-ONLY, no Supabase)
//
//   node scripts/sales-metrics-reconciliation/reconcile-vendas.mjs \
//     --start 2026-09-01 --end 2026-09-30 [--filial 060420]
//
// Purpose (Discovery → first implementation slice, bounded scope):
// prove we can derive the intended Portal salesperson KPIs correctly from
// Linx — using the SAME canonical grain and attribution rule planned for the
// eventual Supabase fact table — BEFORE designing/writing any persistence
// layer. This script performs a SINGLE SELECT against Linx SQL Server and
// makes NO Supabase calls and NO writes of any kind, to Linx or elsewhere.
//
// Canonical grain: one row per (CODIGO_FILIAL, TICKET, DATA_VENDA), sourced
// from dbo.LOJA_VENDA (see linx-vendas-query.sql for the full extraction).
//
// Salesperson attribution rule (locked, confirmed against filial 060420 /
// 2026 data): the responsible salesperson comes ONLY from
// dbo.LOJA_VENDA_VENDEDORES, collapsed to DISTINCT (filial, ticket,
// data_venda, vendedor). A ticket's attribution resolves ONLY when exactly
// one distinct VENDEDOR exists for it. Zero or >1 distinct VENDEDOR is an
// ANOMALY — this script never splits, duplicates, or arbitrarily picks one;
// it reports the anomaly count and excludes those tickets from the
// per-salesperson breakdown (they remain in the overall/store-level totals,
// which must stay reconcilable to the existing Power BI report).
//
// KPI definitions (locked, extracted from the live Power BI DAX model):
//   valid ticket        = DATA_HORA_CANCELAMENTO IS NULL
//   venda_liquida        = SUM(VALOR_PAGO) over valid tickets
//                           (VALOR_PAGO is already net of trocas)
//   tickets_validos      = COUNT(ticket) over valid tickets
//   pecas_brutas         = SUM(QTDE_TOTAL) over valid tickets
//   pecas_troca          = SUM(QTDE_TROCA_TOTAL) over valid tickets
//   pecas_liquidas        = pecas_brutas - pecas_troca
//   ticket_medio         = venda_liquida / tickets_validos
//   PA                   = pecas_liquidas / tickets_validos
//   PM                   = venda_liquida / pecas_liquidas
// All ratios are null (displayed "—") when their denominator is zero —
// never silently reported as 0, which would misrepresent "no data" as "zero
// value".
//
// Commission/payroll calculation is explicitly OUT OF SCOPE — this script
// only identifies the responsible salesperson per ticket, never a
// commission or payroll amount.
//
// Secrets come only from scripts/sales-metrics-reconciliation/.env
// (gitignored, same convention as scripts/sync-estoque/.env).
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILIAL = "060420"; // V1/test filial — CLI-configurable, not hard-coded elsewhere.

// -----------------------------------------------------------------------------
// Minimal .env loader (no dependency, mirrors scripts/sync-estoque/sync-estoque.mjs).
// -----------------------------------------------------------------------------
function loadDotEnv(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(join(HERE, ".env"));

export function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(
      `ERROR: missing required env var ${name} (set it in scripts/sales-metrics-reconciliation/.env)`,
    );
    process.exit(2);
  }
  return v.trim();
}

function getLinxConfig() {
  return {
    server: requireEnv("LINX_SQL_SERVER"),
    port: Number(process.env.LINX_SQL_PORT || 1433),
    database: requireEnv("LINX_SQL_DATABASE"),
    user: requireEnv("LINX_SQL_USER"),
    password: requireEnv("LINX_SQL_PASSWORD"),
    encrypt: /^true$/i.test(process.env.LINX_SQL_ENCRYPT || "false"),
  };
}

export const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// -----------------------------------------------------------------------------
// CLI argument parsing
// -----------------------------------------------------------------------------
export function parseArgs(argv) {
  const get = (name) => {
    const idx = argv.indexOf(name);
    if (idx === -1 || idx === argv.length - 1) return null;
    return argv[idx + 1];
  };

  const filial = get("--filial") || DEFAULT_FILIAL;
  const start = get("--start");
  const end = get("--end");

  if (!start || !end) {
    throw new Error(
      "both --start and --end are required (YYYY-MM-DD, inclusive). " +
        "Example: --start 2026-09-01 --end 2026-09-30",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error(`--start must be YYYY-MM-DD, got "${start}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error(`--end must be YYYY-MM-DD, got "${end}"`);

  const startDate = new Date(`${start}T00:00:00Z`);
  const endDateInclusive = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) throw new Error(`--start is not a valid calendar date: "${start}"`);
  if (Number.isNaN(endDateInclusive.getTime())) throw new Error(`--end is not a valid calendar date: "${end}"`);
  if (endDateInclusive.getTime() < startDate.getTime()) {
    throw new Error(`--end (${end}) must not be before --start (${start})`);
  }

  // Half-open range for the SQL bind params: [start, end+1day).
  const endDateExclusive = new Date(endDateInclusive);
  endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1);

  return { filial, start, end, startDate, endDateExclusive };
}

// -----------------------------------------------------------------------------
// Read-only safety net: this script issues exactly one query file. Assert it
// really is a single read-only statement before ever sending it to Linx —
// defense in depth, not a substitute for the dedicated read-only SQL login
// documented in README.md.
// -----------------------------------------------------------------------------
const FORBIDDEN_SQL_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|EXEC|EXECUTE|CREATE|GRANT|REVOKE)\b/i;

export function assertReadOnlyQuery(queryText) {
  if (FORBIDDEN_SQL_KEYWORDS.test(queryText)) {
    throw new Error(
      "refusing to run: query text contains a mutating/DDL keyword — this tool must stay read-only",
    );
  }
}

// -----------------------------------------------------------------------------
// Pure classification / KPI logic (no I/O) — unit-tested in
// test-reconcile-vendas.mjs.
// -----------------------------------------------------------------------------

function dateKeyOf(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

// Attaches derived boolean flags to one extracted row. Input fields are the
// exact columns produced by linx-vendas-query.sql.
export function classifyTicket(row) {
  const isCancelled = row.data_hora_cancelamento != null;
  const isValid = !isCancelled;
  const vendedoresDistintos = Number(row.vendedores_distintos) || 0;
  const isZeroAttribution = vendedoresDistintos === 0;
  const isMultiAttribution = vendedoresDistintos > 1;
  const isResolved = vendedoresDistintos === 1 && row.vendedor_codigo != null;
  return {
    ...row,
    canonicalKey: `${row.codigo_filial}|${row.ticket}|${dateKeyOf(row.data_venda)}`,
    isCancelled,
    isValid,
    vendedoresDistintos,
    isZeroAttribution,
    isMultiAttribution,
    isResolved,
  };
}

// Detects violations of the assumed-unique (CODIGO_FILIAL, TICKET,
// DATA_VENDA) canonical key. Never assumed true without checking — this is
// exactly the kind of invariant the dry-run exists to verify, not just
// restate.
export function detectDuplicateCanonicalKeys(classifiedRows) {
  const counts = new Map();
  for (const r of classifiedRows) {
    counts.set(r.canonicalKey, (counts.get(r.canonicalKey) || 0) + 1);
  }
  let duplicateKeyCount = 0;
  let duplicateRowCount = 0;
  for (const c of counts.values()) {
    if (c > 1) {
      duplicateKeyCount += 1;
      duplicateRowCount += c;
    }
  }
  return { canonicalKeyCount: counts.size, duplicateKeyCount, duplicateRowCount };
}

function sumBy(rows, field) {
  return rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

// Safe ratio: null (never 0) when the denominator is zero, so "no data" is
// never misreported as "a measured zero value".
function safeDiv(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

// Computes the locked KPI set over whatever row population is passed in.
// Caller decides the population (overall valid tickets, or valid+resolved
// tickets for one salesperson) — this function has no opinion about scope.
export function computeKpis(rows) {
  const vendaLiquida = sumBy(rows, "valor_pago");
  const tickets = rows.length;
  const pecasBrutas = sumBy(rows, "qtde_total");
  const pecasTroca = sumBy(rows, "qtde_troca_total");
  const pecasLiquidas = pecasBrutas - pecasTroca;
  return {
    vendaLiquida,
    tickets,
    pecasBrutas,
    pecasTroca,
    pecasLiquidas,
    ticketMedio: safeDiv(vendaLiquida, tickets),
    pa: safeDiv(pecasLiquidas, tickets),
    pm: safeDiv(vendaLiquida, pecasLiquidas),
  };
}

// Groups valid, cleanly-resolved (exactly one distinct VENDEDOR) rows by
// salesperson. Anomalous tickets (zero or >1 distinct vendedor) are
// deliberately excluded here — they are counted separately in the report,
// never force-attributed to a salesperson.
export function groupBySalesperson(classifiedValidRows) {
  const byVendedor = new Map();
  for (const r of classifiedValidRows) {
    if (!r.isResolved) continue;
    const key = r.vendedor_codigo;
    if (!byVendedor.has(key)) {
      byVendedor.set(key, {
        vendedorCodigo: key,
        vendedorNome: r.vendedor_nome ?? null,
        vendedorApelido: r.vendedor_apelido ?? null,
        rows: [],
      });
    }
    byVendedor.get(key).rows.push(r);
  }

  const result = [];
  for (const entry of byVendedor.values()) {
    result.push({
      vendedorCodigo: entry.vendedorCodigo,
      vendedorNome: entry.vendedorNome,
      vendedorApelido: entry.vendedorApelido,
      kpis: computeKpis(entry.rows),
    });
  }
  result.sort((a, b) => b.kpis.vendaLiquida - a.kpis.vendaLiquida);
  return result;
}

// Full orchestration: raw extracted rows -> complete reconciliation report.
// Pure function — no I/O — so it is directly unit-testable with fixtures.
export function buildReport(rawRows, { filial, start, end }) {
  const rows = rawRows.map(classifyTicket);
  const dup = detectDuplicateCanonicalKeys(rows);

  const validRows = rows.filter((r) => r.isValid);
  const cancelledTicketCount = rows.length - validRows.length;

  const zeroAttributionCount = rows.filter((r) => r.isZeroAttribution).length;
  const multiAttributionCount = rows.filter((r) => r.isMultiAttribution).length;
  const validZeroAttributionCount = validRows.filter((r) => r.isZeroAttribution).length;
  const validMultiAttributionCount = validRows.filter((r) => r.isMultiAttribution).length;

  return {
    filial,
    start,
    end,
    totalRowsExamined: rows.length,
    canonicalTicketCount: dup.canonicalKeyCount,
    duplicateCanonicalKeyCount: dup.duplicateKeyCount,
    duplicateRowCount: dup.duplicateRowCount,
    validTicketCount: validRows.length,
    cancelledTicketCount,
    zeroAttributionCount,
    multiAttributionCount,
    // Valid tickets that cannot be placed in ANY salesperson's bucket —
    // the real "coverage gap" figure once cancellations are excluded.
    validUnattributedCount: validZeroAttributionCount + validMultiAttributionCount,
    overallKpis: computeKpis(validRows),
    perSalesperson: groupBySalesperson(validRows),
  };
}

// -----------------------------------------------------------------------------
// Formatting helpers for console output
// -----------------------------------------------------------------------------
function fmtInt(n) {
  return Number(n).toLocaleString("pt-BR");
}
function fmtBRL(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtRatio(n, decimals = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function printReport(report, { elapsedMs } = {}) {
  const line = () => console.log("-".repeat(78));

  console.log("\n=== Salesperson Metrics — Dry-run Linx Reconciliation ===\n");
  console.log(`Filial (CODIGO_FILIAL): ${report.filial}`);
  console.log(`Period (inclusive):     ${report.start} .. ${report.end}`);
  if (elapsedMs != null) console.log(`Linx query time:        ${(elapsedMs / 1000).toFixed(2)}s`);
  line();

  console.log(`LOJA_VENDA rows examined:              ${fmtInt(report.totalRowsExamined)}`);
  console.log(`Canonical ticket count:                ${fmtInt(report.canonicalTicketCount)}`);
  console.log(`Valid ticket count:                     ${fmtInt(report.validTicketCount)}`);
  console.log(`Cancelled ticket count:                 ${fmtInt(report.cancelledTicketCount)}`);
  console.log(
    `Duplicate canonical keys:               ${fmtInt(report.duplicateCanonicalKeyCount)}` +
      (report.duplicateCanonicalKeyCount > 0 ? `  <-- ANOMALY (${fmtInt(report.duplicateRowCount)} rows affected)` : ""),
  );
  console.log(
    `Tickets w/ ZERO salesperson attribution: ${fmtInt(report.zeroAttributionCount)}` +
      (report.zeroAttributionCount > 0 ? "  <-- ANOMALY" : ""),
  );
  console.log(
    `Tickets w/ >1 distinct salesperson:      ${fmtInt(report.multiAttributionCount)}` +
      (report.multiAttributionCount > 0 ? "  <-- ANOMALY" : ""),
  );
  console.log(
    `Valid tickets excluded from per-salesperson view (anomalous): ${fmtInt(report.validUnattributedCount)}`,
  );
  line();

  if (report.duplicateCanonicalKeyCount > 0) {
    console.log(
      "\n!!! INVARIANT VIOLATION: (CODIGO_FILIAL, TICKET, DATA_VENDA) is not unique for this " +
        "period/filial. The canonical-grain assumption does not hold here — do not trust the " +
        "KPI totals below until this is investigated. !!!\n",
    );
  }

  console.log("\n--- OVERALL (store-level, should reconcile directly to Power BI) ---");
  printKpiBlock(report.overallKpis);

  console.log("\n--- PER SALESPERSON (LOJA_VENDA_VENDEDORES attribution — may differ from Power BI,");
  console.log("    which currently filters by LOJA_VENDA.VENDEDOR. That difference is expected and");
  console.log("    should be reported, not corrected away.) ---\n");

  if (report.perSalesperson.length === 0) {
    console.log("  (no salesperson resolved any valid ticket in this period)");
  } else {
    for (const sp of report.perSalesperson) {
      const label = [sp.vendedorApelido, sp.vendedorNome].filter(Boolean).join(" / ");
      console.log(`  VENDEDOR ${sp.vendedorCodigo}${label ? `  (${label})` : ""}`);
      printKpiBlock(sp.kpis, "    ");
      console.log("");
    }
  }
}

function printKpiBlock(kpis, indent = "  ") {
  console.log(`${indent}Venda líquida:   ${fmtBRL(kpis.vendaLiquida)}`);
  console.log(`${indent}Tickets válidos: ${fmtInt(kpis.tickets)}`);
  console.log(`${indent}Peças brutas:    ${fmtInt(kpis.pecasBrutas)}`);
  console.log(`${indent}Peças de troca:  ${fmtInt(kpis.pecasTroca)}`);
  console.log(`${indent}Peças líquidas:  ${fmtInt(kpis.pecasLiquidas)}`);
  console.log(`${indent}Ticket médio:    ${fmtBRL(kpis.ticketMedio)}`);
  console.log(`${indent}PA:              ${fmtRatio(kpis.pa)}`);
  console.log(`${indent}PM:              ${fmtBRL(kpis.pm)}`);
}

// -----------------------------------------------------------------------------
// Linx extraction (I/O) — the ONLY place this script talks to Linx. Single
// SELECT, single connection, pool size 1, 180s timeout (mirrors
// scripts/sync-estoque/sync-estoque.mjs). No writes are issued anywhere in
// this file.
// -----------------------------------------------------------------------------
async function extractFromLinx(sql, { filial, startDate, endDateExclusive }) {
  const linx = getLinxConfig();
  const queryText = readFileSync(join(HERE, "linx-vendas-query.sql"), "utf8");
  assertReadOnlyQuery(queryText);

  log(`connecting to Linx SQL Server ${linx.server}:${linx.port} / ${linx.database} ...`);
  const pool = await sql.connect({
    server: linx.server,
    port: linx.port,
    database: linx.database,
    user: linx.user,
    password: linx.password,
    options: {
      encrypt: linx.encrypt,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    requestTimeout: 180_000,
    pool: { max: 1 },
  });

  try {
    const result = await pool
      .request()
      .input("filial", sql.VarChar, filial)
      .input("data_inicio", sql.Date, startDate)
      .input("data_fim", sql.Date, endDateExclusive)
      .query(queryText);
    return result.recordset ?? [];
  } finally {
    await pool.close();
  }
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));

  log(
    `dry-run reconciliation — filial=${args.filial} period=${args.start}..${args.end} ` +
      "(READ-ONLY against Linx, NO Supabase calls)",
  );

  const { default: sql } = await import("mssql");

  const queryStartedAt = Date.now();
  const rawRows = await extractFromLinx(sql, {
    filial: args.filial,
    startDate: args.startDate,
    endDateExclusive: args.endDateExclusive,
  });
  const elapsedMs = Date.now() - queryStartedAt;

  const report = buildReport(rawRows, { filial: args.filial, start: args.start, end: args.end });
  printReport(report, { elapsedMs });

  log(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

// Entry-point guard (mirrors scripts/sync-estoque/sync-estoque.mjs): this
// file exports pure functions that test-reconcile-vendas.mjs imports for
// offline unit testing. Without this guard, merely importing the module
// would require Linx env vars and attempt a connection as a side effect.
const isDirectEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntryPoint) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
