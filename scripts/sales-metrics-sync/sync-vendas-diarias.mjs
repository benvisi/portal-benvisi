#!/usr/bin/env node
// =============================================================================
// Salesperson Metrics Portal V1 — Slice A — production Linx -> Supabase sync.
//
//   node scripts/sales-metrics-sync/sync-vendas-diarias.mjs [--dry-run]
//     [--filial 060420] [--dates 2026-09-30,2026-10-01]
//
// Publishes curated daily salesperson sales aggregates
// (public.vendas_diarias_vendedor) for the Portal to read later via
// get_vendas_metricas_mtd. The browser never queries Linx directly — this
// script is the only thing that does, and it is the only writer of
// vendas_diarias_vendedor (through the vendas_diarias_substituir_dia RPC).
//
// Reuses the LOCKED Linx extraction/classification logic from
// scripts/sales-metrics-reconciliation/reconcile-vendas.mjs verbatim
// (same query file, same classifyTicket/buildReport/groupBySalesperson) —
// this script does not redefine ticket grain, attribution, cancellation, or
// KPI rules. See that script's header comment for the full rationale.
//
// Default behavior (no --dates given): refreshes TODAY and YESTERDAY
// (America/Manaus calendar days), so late cancellations/corrections posted
// in Linx after midnight are picked up by the next run. Each day is
// resynced independently via vendas_diarias_substituir_dia, which deletes
// and re-inserts that day's full row set in one transaction — safe to
// rerun any number of times for the same day (idempotent).
//
// Three categories of valid ticket are excluded from the published
// aggregates, on purpose, and reported to stdout rather than guessed:
//   - zero-attribution anomaly  (no LOJA_VENDA_VENDEDORES row for the ticket)
//   - multi-attribution anomaly (>1 distinct VENDEDOR for the ticket)
//   - unmapped VENDEDOR code    (resolves to exactly one VENDEDOR, but that
//                                 code has no funcionarios.codigo_vendedor_linx
//                                 mapping yet — never guessed by name)
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
// be reported as unmapped instead — never guessed by name.
// -----------------------------------------------------------------------------
export function resolveMappedRows(perSalesperson, mapaPorCodigo) {
  const mapeadas = [];
  const naoMapeadas = [];
  for (const sp of perSalesperson) {
    const alvo = mapaPorCodigo.get(Number(sp.vendedorCodigo));
    if (!alvo) {
      naoMapeadas.push(sp);
      continue;
    }
    mapeadas.push({
      funcionario_id: alvo.funcionarioId,
      codigo_vendedor_linx: Number(sp.vendedorCodigo),
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
    mapa.set(Number(r.codigo_vendedor_linx), { funcionarioId: r.funcionario_id, nome: r.nome });
  }
  return mapa;
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
  const zeroAttributionCount = validRows.filter((r) => r.isZeroAttribution).length;
  const multiAttributionCount = validRows.filter((r) => r.isMultiAttribution).length;

  const perSalesperson = groupBySalesperson(validRows);
  const { mapeadas, naoMapeadas } = resolveMappedRows(perSalesperson, mapaPorCodigo);

  log(
    `${dateStr}: examined=${classified.length} validas=${validRows.length} canceladas=${cancelledCount} ` +
      `atribuicao_zero=${zeroAttributionCount} atribuicao_multipla=${multiAttributionCount} ` +
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

  if (dryRun) {
    log(`${dateStr}: dry-run — skipping write (${mapeadas.length} rows would be written)`);
    return { dateStr, skipped: false, written: 0, dryRun: true };
  }

  const { data, error } = await supabase.rpc("vendas_diarias_substituir_dia", {
    p_codigo_filial: filial,
    p_data_venda: dateStr,
    p_linhas: mapeadas,
  });
  if (error)
    throw new Error(`vendas_diarias_substituir_dia failed for ${dateStr}: ${error.message}`);

  const resultado = Array.isArray(data) ? data[0] : data;
  log(
    `${dateStr}: wrote ${resultado?.linhas_inseridas ?? mapeadas.length} rows ` +
      `(removed ${resultado?.linhas_removidas ?? "?"} previous rows for this day)`,
  );
  return { dateStr, skipped: false, written: resultado?.linhas_inseridas ?? mapeadas.length };
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
