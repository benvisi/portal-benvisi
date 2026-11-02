#!/usr/bin/env node
// =============================================================================
// Salesperson Metrics — MANUAL historical backfill of the daily aggregates.
//
//   node scripts/sales-metrics-sync/backfill-vendas-diarias.mjs
//     --from 2023-01-01 --to 2026-11-02 [--dry-run] [--filial 060420]
//
// Fills public.vendas_diarias_vendedor / vendas_diarias_loja /
// vendas_diarias_anomalias for an explicit inclusive date range. It is NOT
// part of the recurring 5-minute sync (which only refreshes today + yesterday)
// and must be run by hand.
//
// Reuses the production sync's day-processing logic verbatim
// (processDayRows from sync-vendas-diarias.mjs: same Linx query file, same
// classifyTicket / computeKpis / groupBySalesperson, same explicit
// codigo_vendedor_linx mapping, same vendas_diarias_substituir_dia write).
// The only difference is batching: ONE read-only Linx query per calendar
// month (the query returns ticket rows with DATA_VENDA, which are split by
// day in memory) instead of one query per day — ~47 queries for 2023-01-01 ->
// today instead of ~1,400. Ticket rows are processed in memory only; nothing
// transaction-level is stored.
//
// Idempotent / resumable: every day is replaced as a whole through
// vendas_diarias_substituir_dia (delete + insert in one transaction), so
// rerunning any range — or the whole thing — never creates duplicates and may
// run alongside the 5-minute sync (both recompute a day from Linx; last write
// wins with the same data). To resume after a failure, rerun with --from set
// to the first batch start the script printed.
//
// Days with no Linx tickets at all are not written (reported as "empty days");
// existing rows for such a day are left untouched.
//
// --dry-run extracts and classifies everything (and still reads the vendor
// mapping from Supabase, so SUPABASE_SERVICE_ROLE_KEY is required) but never
// calls the write RPC.
//
// Secrets come only from scripts/sales-metrics-sync/.env (gitignored).
// =============================================================================

import { pathToFileURL } from "node:url";
import process from "node:process";

import {
  buildMappingIndex,
  extractRangeFromLinx,
  getSupabaseConfig,
  log,
  manausDateString,
  processDayRows,
} from "./sync-vendas-diarias.mjs";

const DEFAULT_FILIAL = "060420";
const EARLIEST_ALLOWED_FROM = "2000-01-01";
const DAY_MS = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Pure helpers (unit-tested in test-backfill-vendas-diarias.mjs).
// -----------------------------------------------------------------------------
export function assertIsoDate(value, flag) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} must be YYYY-MM-DD, got "${value}"`);
  }
  const roundTrip = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(roundTrip.getTime()) || roundTrip.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} is not a real calendar date: "${value}"`);
  }
  return value;
}

export function addDays(dateStr, days) {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// --from and --to are both mandatory: a backfill range is always explicit.
export function parseBackfillArgs(argv, { now = new Date() } = {}) {
  const get = (name) => {
    const idx = argv.indexOf(name);
    if (idx === -1 || idx === argv.length - 1) return null;
    return argv[idx + 1];
  };

  const from = get("--from");
  const to = get("--to");
  if (!from || !to) throw new Error("both --from YYYY-MM-DD and --to YYYY-MM-DD are required");
  assertIsoDate(from, "--from");
  assertIsoDate(to, "--to");
  if (from < EARLIEST_ALLOWED_FROM) throw new Error(`--from must be >= ${EARLIEST_ALLOWED_FROM}`);
  if (from > to) throw new Error(`--from (${from}) must not be after --to (${to})`);
  const today = manausDateString(now);
  if (to > today)
    throw new Error(`--to (${to}) must not be in the future (Manaus today: ${today})`);

  return {
    dryRun: argv.includes("--dry-run"),
    filial: get("--filial") || DEFAULT_FILIAL,
    from,
    to,
  };
}

// Splits the inclusive [from, to] range into calendar-month batches, clipped
// to the range. endExclusive is the half-open end the Linx query expects.
export function monthBatches(from, to) {
  const batches = [];
  let start = from;
  while (start <= to) {
    const [y, m] = start.split("-").map(Number);
    const nextMonthStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const end = addDays(nextMonthStart, -1) < to ? addDays(nextMonthStart, -1) : to;
    batches.push({ start, end, endExclusive: addDays(end, 1) });
    start = addDays(end, 1);
  }
  return batches;
}

function dateKeyOf(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// Groups the batch's ticket rows by DATA_VENDA (YYYY-MM-DD), ascending.
export function groupRowsByDate(rawRows) {
  const byDate = new Map();
  for (const row of rawRows) {
    const key = dateKeyOf(row.data_venda);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(row);
  }
  return new Map([...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// Accumulates unmapped-vendedor totals across days so the operator sees, once
// at the end, which historical VENDEDOR codes still lack a
// funcionarios.codigo_vendedor_linx mapping (their sales land in "Outros").
export function accumulateUnmapped(acc, dateStr, naoMapeadas) {
  for (const sp of naoMapeadas ?? []) {
    const codigo = String(sp.vendedorCodigo).trim();
    const cur = acc.get(codigo) ?? {
      codigo,
      nome: sp.vendedorNome ?? "",
      apelido: sp.vendedorApelido ?? "",
      dias: new Set(),
      tickets: 0,
      vendaLiquida: 0,
    };
    cur.dias.add(dateStr);
    if (!cur.primeiroDia || dateStr < cur.primeiroDia) cur.primeiroDia = dateStr;
    if (!cur.ultimoDia || dateStr > cur.ultimoDia) cur.ultimoDia = dateStr;
    cur.tickets += sp.kpis.tickets;
    cur.vendaLiquida += sp.kpis.vendaLiquida;
    acc.set(codigo, cur);
  }
  return acc;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  const args = parseBackfillArgs(process.argv.slice(2));
  const batches = monthBatches(args.from, args.to);

  log(
    `sales-metrics BACKFILL — filial=${args.filial} range=${args.from}..${args.to} ` +
      `batches=${batches.length} (one Linx query each) mode=${args.dryRun ? "DRY-RUN (no writes)" : "REAL"}`,
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

  const totals = { daysProcessed: 0, emptyDays: 0, skippedDays: [], linxQueries: 0, tickets: 0 };
  const unmapped = new Map();
  let earliestWithData = null;

  for (const [i, batch] of batches.entries()) {
    const label = `batch ${i + 1}/${batches.length} ${batch.start}..${batch.end}`;
    try {
      const t0 = Date.now();
      const rawRows = await extractRangeFromLinx(sql, {
        filial: args.filial,
        startStr: batch.start,
        endExclusiveStr: batch.endExclusive,
      });
      totals.linxQueries += 1;
      totals.tickets += rawRows.length;
      const linxElapsedMs = Date.now() - t0;
      const byDate = groupRowsByDate(rawRows);
      const calendarDays = (Date.parse(batch.endExclusive) - Date.parse(batch.start)) / DAY_MS;
      totals.emptyDays += calendarDays - byDate.size;
      log(
        `${label}: ${rawRows.length} ticket rows over ${byDate.size}/${calendarDays} days ` +
          `(linx_query_ms=${linxElapsedMs})`,
      );

      for (const [dateStr, dayRows] of byDate) {
        const result = await processDayRows(supabase, mapaPorCodigo, {
          filial: args.filial,
          dateStr,
          dryRun: args.dryRun,
          rawRows: dayRows,
          linxElapsedMs,
        });
        if (result.skipped) {
          totals.skippedDays.push(dateStr);
          continue;
        }
        totals.daysProcessed += 1;
        accumulateUnmapped(unmapped, dateStr, result.naoMapeadas);
        if (!earliestWithData || dateStr < earliestWithData) earliestWithData = dateStr;
      }
    } catch (e) {
      console.error(`FAILED in ${label}: ${e?.message ?? e}`);
      console.error(
        `Safe to resume (idempotent): rerun with --from ${batch.start} --to ${args.to}` +
          `${args.dryRun ? " --dry-run" : ""} --filial ${args.filial}`,
      );
      process.exit(1);
    }
  }

  log(
    `done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — linx_queries=${totals.linxQueries} ` +
      `ticket_rows=${totals.tickets} days_${args.dryRun ? "would_write" : "written"}=${totals.daysProcessed} ` +
      `empty_days_skipped=${totals.emptyDays} earliest_day_with_data=${earliestWithData ?? "none"}`,
  );
  if (unmapped.size > 0) {
    log("unmapped VENDEDOR codes across the whole range (their sales appear under Outros):");
    for (const u of [...unmapped.values()].sort((a, b) => b.vendaLiquida - a.vendaLiquida)) {
      log(
        `  codigo=${u.codigo} nome="${u.nome}" apelido="${u.apelido}" ` +
          `de=${u.primeiroDia} ate=${u.ultimoDia} dias=${u.dias.size} tickets=${u.tickets} ` +
          `venda_liquida=${u.vendaLiquida.toFixed(2)}`,
      );
    }
  }
  if (totals.skippedDays.length > 0) {
    console.error(
      `!!! ${totals.skippedDays.length} day(s) skipped (duplicate canonical keys — NOT written): ` +
        totals.skippedDays.join(","),
    );
    process.exit(3);
  }
}

// Entry-point guard (mirrors sync-vendas-diarias.mjs): lets this file export
// pure functions for offline unit testing without env vars or connections.
const isDirectEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntryPoint) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
