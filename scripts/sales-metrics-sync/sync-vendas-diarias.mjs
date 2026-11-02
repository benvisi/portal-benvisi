#!/usr/bin/env node
// =============================================================================
// Salesperson Metrics Portal V1 — Slice A — production Linx -> Supabase sync.
//
//   node scripts/sales-metrics-sync/sync-vendas-diarias.mjs [--dry-run]
//     [--filial 060420] [--dates 2026-09-30,2026-10-01]
//
// Publishes curated daily salesperson sales aggregates
// (public.vendas_diarias_vendedor, public.vendas_diarias_loja,
// public.vendas_diarias_anomalias) for the Portal to read later via
// get_vendas_metricas_mtd. The browser never queries Linx directly — this
// script is the only thing that does, and it is the only writer of these
// tables (through the vendas_diarias_substituir_dia RPC).
//
// Reuses the LOCKED Linx extraction/classification/KPI logic from
// scripts/sales-metrics-reconciliation/reconcile-vendas.mjs verbatim (same
// query file, same classifyTicket/computeKpis/groupBySalesperson) — this
// script does not redefine ticket grain, attribution, cancellation, or KPI
// rules. In particular, the store-level "Total" published here is
// computeKpis(validRows) — the exact same overallKpis logic already
// validated against Power BI by the reconciliation tool — never a sum of
// mapped salesperson rows.
//
// Default behavior (no --dates given): refreshes TODAY and YESTERDAY
// (America/Manaus calendar days), so late cancellations/corrections posted
// in Linx after midnight are picked up by the next run. Each day is
// resynced independently via vendas_diarias_substituir_dia, which deletes
// and re-inserts that day's full row set (across all three tables, in one
// transaction) — safe to rerun any number of times for the same day
// (idempotent).
//
// Three categories of valid ticket cannot be placed in a displayed
// salesperson row. They are never guessed/allocated; instead their additive
// totals are published to vendas_diarias_anomalias (pure diagnostics — the
// Portal's "Outros" row is derived from Total minus mapped salespeople at
// read time, not from this table) and logged to stdout:
//   - zero-attribution anomaly  (no LOJA_VENDA_VENDEDORES row for the ticket)
//   - multi-attribution anomaly (>1 distinct VENDEDOR for the ticket)
//   - unmapped VENDEDOR code    (resolves to exactly one VENDEDOR, but that
//                                 code has no funcionarios.codigo_vendedor_linx
//                                 mapping yet — never guessed by name)
//
// VENDEDOR codes are text (dbo.LOJA_VENDA_VENDEDORES.VENDEDOR is CHAR(4) on
// the live Linx schema — verified via sys.columns, not inferred from
// sample values) — never coerced to a number anywhere in this pipeline, so
// a future leading-zero code is never silently corrupted.
//
// --dry-run runs the full extract/classify/map pipeline and prints every
// count, but never calls the write RPC (no durable Supabase writes). It
// still calls the read-only mapping RPC, so a real SUPABASE_SERVICE_ROLE_KEY
// is required even in dry-run mode.
//
// Secrets come only from scripts/sales-metrics-sync/.env (gitignored).
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

import {
  classifyTicket,
  detectDuplicateCanonicalKeys,
  computeKpis,
  groupBySalesperson,
  assertReadOnlyQuery,
} from "../sales-metrics-reconciliation/reconcile-vendas.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECONCILIATION_DIR = join(HERE, "..", "sales-metrics-reconciliation");
const DEFAULT_FILIAL = "060420";
const MANAUS_TZ = "America/Manaus";

// -----------------------------------------------------------------------------
// Minimal .env loader (no dependency — mirrors scripts/sync-estoque and
// scripts/sales-metrics-reconciliation).
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
      `ERROR: missing required env var ${name} (set it in scripts/sales-metrics-sync/.env)`,
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

function getSupabaseConfig() {
  return {
    url: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// -----------------------------------------------------------------------------
// Manaus calendar-day helpers (pure). Amazonas has observed a fixed UTC-4
// offset with no DST since 2003, so formatting a UTC instant in this
// timezone is stable and does not need a date library.
// -----------------------------------------------------------------------------
export function manausDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANAUS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function defaultSyncDates(now = new Date()) {
  const today = manausDateString(now);
  const yesterday = manausDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return [yesterday, today];
}

// -----------------------------------------------------------------------------
// CLI argument parsing (pure).
// -----------------------------------------------------------------------------
export function parseArgs(argv, { now = new Date() } = {}) {
  const get = (name) => {
    const idx = argv.indexOf(name);
    if (idx === -1 || idx === argv.length - 1) return null;
    return argv[idx + 1];
  };

  const dryRun = argv.includes("--dry-run");
  const filial = get("--filial") || DEFAULT_FILIAL;
  const datesArg = get("--dates");

  let dates;
  if (datesArg) {
    dates = datesArg.split(",").map((s) => s.trim());
    for (const d of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        throw new Error(`--dates entries must be YYYY-MM-DD, got "${d}"`);
    }
  } else {
    dates = defaultSyncDates(now);
  }

  return { dryRun, filial, dates };
}

// -----------------------------------------------------------------------------
// Mapping resolution (pure). Splits a day's per-salesperson report entries
// into rows ready to write (mapped to a funcionario_id) and ones that must
// be reported as unmapped instead — never guessed by name. VENDEDOR codes
// are compared as exact (trimmed) text — never coerced to a number, since
// the live Linx column is CHAR(4), not numeric.
// -----------------------------------------------------------------------------
function normalizeCodigo(codigo) {
  return String(codigo).trim();
}

export function resolveMappedRows(perSalesperson, mapaPorCodigo) {
  const mapeadas = [];
  const naoMapeadas = [];
  for (const sp of perSalesperson) {
    const codigo = normalizeCodigo(sp.vendedorCodigo);
    const alvo = mapaPorCodigo.get(codigo);
    if (!alvo) {
      naoMapeadas.push(sp);
      continue;
    }
    mapeadas.push({
      funcionario_id: alvo.funcionarioId,
      codigo_vendedor_linx: codigo,
      venda_liquida: sp.kpis.vendaLiquida,
      tickets: sp.kpis.tickets,
      pecas_brutas: sp.kpis.pecasBrutas,
      pecas_troca: sp.kpis.pecasTroca,
    });
  }
  return { mapeadas, naoMapeadas };
}

export function buildMappingIndex(mappingRows) {
  const mapa = new Map();
  for (const r of mappingRows) {
    if (r.codigo_vendedor_linx == null) continue;
    mapa.set(normalizeCodigo(r.codigo_vendedor_linx), {
      funcionarioId: r.funcionario_id,
      nome: r.nome,
    });
  }
  return mapa;
}

// Sums the additive KPI ingredients across a list of { kpis } entries (e.g.
// the unmapped-vendedor entries from resolveMappedRows, each already
// aggregated by groupBySalesperson). Pure arithmetic — no ticket-level
// recomputation.
export function sumKpis(entries) {
  return entries.reduce(
    (acc, entry) => ({
      vendaLiquida: acc.vendaLiquida + entry.kpis.vendaLiquida,
      tickets: acc.tickets + entry.kpis.tickets,
      pecasBrutas: acc.pecasBrutas + entry.kpis.pecasBrutas,
      pecasTroca: acc.pecasTroca + entry.kpis.pecasTroca,
    }),
    { vendaLiquida: 0, tickets: 0, pecasBrutas: 0, pecasTroca: 0 },
  );
}

// Shapes a computeKpis()-style ingredient set into the jsonb payload the
// vendas_diarias_substituir_dia RPC expects (store-total / anomaly-category
// rows only carry the four additive ingredients, never the derived ratios).
function toAdditivePayload(kpis) {
  return {
    venda_liquida: kpis.vendaLiquida,
    tickets: kpis.tickets,
    pecas_brutas: kpis.pecasBrutas,
    pecas_troca: kpis.pecasTroca,
  };
}

// Sums several additive ingredient sets (computeKpis() results and/or
// sumKpis() results — both expose the same four fields) into one. Used here
// to preview, locally, what get_vendas_metricas_mtd's Outros row will equal
// for this day's contribution (zero-attribution + multi-attribution +
// unmapped) — NOT used to compute the published Outros value itself, which
// the RPC derives independently (Total minus mapped) at read time. This is
// purely a same-run diagnostic preview/log signal.
export function sumAdditive(kpisList) {
  return kpisList.reduce(
    (acc, k) => ({
      vendaLiquida: acc.vendaLiquida + k.vendaLiquida,
      tickets: acc.tickets + k.tickets,
      pecasBrutas: acc.pecasBrutas + k.pecasBrutas,
      pecasTroca: acc.pecasTroca + k.pecasTroca,
    }),
    { vendaLiquida: 0, tickets: 0, pecasBrutas: 0, pecasTroca: 0 },
  );
}

export function hasNonZeroResidual(residual) {
  return (
    residual.vendaLiquida !== 0 ||
    residual.tickets !== 0 ||
    residual.pecasBrutas !== 0 ||
    residual.pecasTroca !== 0
  );
}

// Mirrors get_vendas_metricas_mtd's ratio formulas exactly (null — never 0
// — when the relevant denominator is zero). Used for diagnostic logging of
// the residual/Outros preview; the Portal reads the real ratios from the
// RPC, not from this script.
export function computeRatios({ vendaLiquida, tickets, pecasBrutas, pecasTroca }) {
  const pecasLiquidas = pecasBrutas - pecasTroca;
  return {
    pecasLiquidas,
    ticketMedio: tickets === 0 ? null : vendaLiquida / tickets,
    pa: tickets === 0 ? null : pecasLiquidas / tickets,
    pm: pecasLiquidas === 0 ? null : vendaLiquida / pecasLiquidas,
  };
}

// -----------------------------------------------------------------------------
// Linx extraction (I/O) — single SELECT per day, same query file/connection
// options as reconcile-vendas.mjs (pool size 1, 180s timeout).
// -----------------------------------------------------------------------------
async function extractDayFromLinx(sql, { filial, dateStr }) {
  const linx = getLinxConfig();
  const queryText = readFileSync(join(RECONCILIATION_DIR, "linx-vendas-query.sql"), "utf8");
  assertReadOnlyQuery(queryText);

  const startDate = new Date(`${dateStr}T00:00:00Z`);
  const endDateExclusive = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

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
// One day's sync: extract -> classify -> map -> (write).
// -----------------------------------------------------------------------------
async function syncOneDay(sql, supabase, mapaPorCodigo, { filial, dateStr, dryRun }) {
  const queryStartedAt = Date.now();
  const rawRows = await extractDayFromLinx(sql, { filial, dateStr });
  const linxElapsedMs = Date.now() - queryStartedAt;

  const classified = rawRows.map(classifyTicket);
  const dup = detectDuplicateCanonicalKeys(classified);
  if (dup.duplicateKeyCount > 0) {
    log(
      `!!! ${dateStr}: invariant violation — ${dup.duplicateKeyCount} duplicate canonical keys ` +
        `(${dup.duplicateRowCount} rows). Skipping this day's write — do not trust this day's data ` +
        "until investigated.",
    );
    return { dateStr, skipped: true };
  }

  const validRows = classified.filter((r) => r.isValid);
  const cancelledCount = classified.length - validRows.length;
  const zeroRows = validRows.filter((r) => r.isZeroAttribution);
  const multiRows = validRows.filter((r) => r.isMultiAttribution);

  const perSalesperson = groupBySalesperson(validRows);
  const { mapeadas, naoMapeadas } = resolveMappedRows(perSalesperson, mapaPorCodigo);

  // Store-level Total ingredients: the SAME computeKpis(validRows) logic
  // reconcile-vendas.mjs already validated against Power BI as "overallKpis"
  // — never reconstructed from the mapped salesperson rows.
  const totalLojaKpis = computeKpis(validRows);
  const zeroKpis = computeKpis(zeroRows);
  const multiKpis = computeKpis(multiRows);
  const naoMapeadasKpis = sumKpis(naoMapeadas);

  log(
    `${dateStr}: examined=${classified.length} validas=${validRows.length} canceladas=${cancelledCount} ` +
      `venda_liquida_total=${totalLojaKpis.vendaLiquida.toFixed(2)} ` +
      `atribuicao_zero=${zeroRows.length} atribuicao_multipla=${multiRows.length} ` +
      `vendedores_mapeados=${mapeadas.length} vendedores_nao_mapeados=${naoMapeadas.length} ` +
      `linx_query_ms=${linxElapsedMs}`,
  );

  if (naoMapeadas.length > 0) {
    for (const sp of naoMapeadas) {
      log(
        `  UNMAPPED vendedor codigo=${sp.vendedorCodigo} nome="${sp.vendedorNome ?? ""}" ` +
          `apelido="${sp.vendedorApelido ?? ""}" tickets=${sp.kpis.tickets} ` +
          `venda_liquida=${sp.kpis.vendaLiquida.toFixed(2)} — excluded, no funcionarios.codigo_vendedor_linx match`,
      );
    }
  }

  const linhasAnomalias = [
    { categoria: "zero_atribuicao", ...toAdditivePayload(zeroKpis) },
    { categoria: "multipla_atribuicao", ...toAdditivePayload(multiKpis) },
    { categoria: "nao_mapeado", ...toAdditivePayload(naoMapeadasKpis) },
  ];

  // Preview-only: not what the Portal shows (the RPC derives Outros as
  // Total minus mapped salespeople independently), just a same-run signal
  // for the operator running this script.
  const residualPreview = sumAdditive([zeroKpis, multiKpis, naoMapeadasKpis]);
  if (hasNonZeroResidual(residualPreview)) {
    const ratios = computeRatios(residualPreview);
    log(
      `  Outros (preview): venda_liquida=${residualPreview.vendaLiquida.toFixed(2)} ` +
        `tickets=${residualPreview.tickets} ticket_medio=${ratios.ticketMedio?.toFixed(2) ?? "—"} ` +
        `pa=${ratios.pa?.toFixed(2) ?? "—"} pm=${ratios.pm?.toFixed(2) ?? "—"}`,
    );
  } else {
    log("  Outros (preview): zero residual — Outros row will be omitted for this day");
  }

  if (dryRun) {
    log(
      `${dateStr}: dry-run — skipping write (${mapeadas.length} salesperson rows would be written)`,
    );
    return { dateStr, skipped: false, written: 0, dryRun: true };
  }

  const { data, error } = await supabase.rpc("vendas_diarias_substituir_dia", {
    p_codigo_filial: filial,
    p_data_venda: dateStr,
    p_linhas_vendedores: mapeadas,
    p_total_loja: toAdditivePayload(totalLojaKpis),
    p_linhas_anomalias: linhasAnomalias,
  });
  if (error)
    throw new Error(`vendas_diarias_substituir_dia failed for ${dateStr}: ${error.message}`);

  const resultado = Array.isArray(data) ? data[0] : data;
  log(
    `${dateStr}: wrote ${resultado?.vendedores_inseridos ?? mapeadas.length} salesperson rows ` +
      `(removed ${resultado?.vendedores_removidos ?? "?"} previous), loja_gravada=${resultado?.loja_gravada ?? "?"}, ` +
      `anomalias=${resultado?.anomalias_inseridas ?? linhasAnomalias.length}`,
  );
  return { dateStr, skipped: false, written: resultado?.vendedores_inseridos ?? mapeadas.length };
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));

  log(
    `sales-metrics sync — filial=${args.filial} dates=${args.dates.join(",")} ` +
      `mode=${args.dryRun ? "DRY-RUN (no writes)" : "REAL"}`,
  );

  const { default: sql } = await import("mssql");
  const { createClient } = await import("@supabase/supabase-js");

  const supabaseConfig = getSupabaseConfig();
  const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: mappingRows, error: mappingError } = await supabase.rpc(
    "vendas_diarias_mapeamento_vendedores",
  );
  if (mappingError) throw new Error(`failed to load vendedor mapping: ${mappingError.message}`);
  const mapaPorCodigo = buildMappingIndex(mappingRows ?? []);
  log(
    `loaded ${mapaPorCodigo.size} mapped vendedor code(s) from funcionarios.codigo_vendedor_linx`,
  );

  const results = [];
  for (const dateStr of args.dates) {
    results.push(
      await syncOneDay(sql, supabase, mapaPorCodigo, {
        filial: args.filial,
        dateStr,
        dryRun: args.dryRun,
      }),
    );
  }

  const totalElapsedMs = Date.now() - startedAt;
  log(`done in ${(totalElapsedMs / 1000).toFixed(1)}s (${results.length} day(s) processed)`);
}

// Entry-point guard (mirrors reconcile-vendas.mjs / sync-estoque.mjs): lets
// this file export pure functions for offline unit testing without
// requiring env vars or attempting a connection as an import side effect.
const isDirectEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntryPoint) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
