#!/usr/bin/env node
// =============================================================================
// Consulta de Estoque — Sync V2 (Linx -> Supabase current-state inventory)
//
//   node scripts/sync-estoque/sync-estoque.mjs                    # real sync
//   node scripts/sync-estoque/sync-estoque.mjs --dry-run          # preview only, no writes
//   node scripts/sync-estoque/sync-estoque.mjs --allow-large-removal [--override-reason "..."]
//   node scripts/sync-estoque/sync-estoque.mjs --bootstrap-v2-from-v1   # one-time, see below
//
// V2 flow (see the Estoque Sync V2 architecture memo for the full design):
//   1. claim a run (estoque_claim_sync) — DB-enforced, at most one active
//      execution at a time; a second run gets BUSY and exits cleanly.
//   2. FULL extraction — from Linx normally, or from the latest successful
//      V1 estoque_snapshot when --bootstrap-v2-from-v1 is given (one-time
//      migration path, not the normal sync source).
//   3. normalize (dash-only placeholder handling, unchanged) + finalize
//      (mojibake repair, trimming) + local validation (unchanged fatal
//      rules).
//   4. group by produto+cor_codigo, compute a deterministic SHA-256 content
//      hash per group (scripts/sync-estoque/estoque-hash.mjs).
//   5. read the compact current group hashes from estoque_atual_grupos
//      (~1,371 rows, never the full current inventory).
//   6. diff locally: novo / alterado / removido / inalterado. Unchanged
//      groups generate NO inventory-row upload.
//   7. stage only changed/new group rows + a compact action manifest.
//   8. estoque_aplicar_sync applies the whole delta atomically in one
//      Postgres transaction — Portal never observes a half-applied state.
//
// Secrets come only from scripts/sync-estoque/.env (gitignored). Nothing is
// ever logged that could expose a credential.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { hashAllGroups, diffGroups, groupKey } from "./estoque-hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHUNK_SIZE = 1000;
const READ_PAGE_SIZE = 1000;
const STALE_CLAIM_MINUTES = 30; // locked (V2 brief section 6) — a normal sync runs in seconds.

// Soft reconciliation baseline for the full canonical extraction row count
// (independent of, and in addition to, the per-group removal guardrail
// below). ~15 506 at the 2026-09-09 inspection. Advisory only — a drift
// beyond +/-15% just logs a WARNING; assortment/grade changes over time are
// expected and must not be rejected.
const RECONCILE_BASELINE = 15506;

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
const ARGV = process.argv.slice(2);
const DRY_RUN = ARGV.includes("--dry-run");
const ALLOW_LARGE_REMOVAL = ARGV.includes("--allow-large-removal");
const BOOTSTRAP_V2 = ARGV.includes("--bootstrap-v2-from-v1");

function flagValue(name) {
  const idx = ARGV.indexOf(name);
  if (idx === -1 || idx === ARGV.length - 1) return null;
  return ARGV[idx + 1];
}
const OVERRIDE_REASON = flagValue("--override-reason");

// -----------------------------------------------------------------------------
// Minimal .env loader (no dependency). KEY=VALUE lines, # comments, optional
// surrounding quotes. Only fills vars not already set in the environment.
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
    console.error(`ERROR: missing required env var ${name} (set it in scripts/sync-estoque/.env)`);
    process.exit(2);
  }
  return v.trim();
}

function getSupabaseConfig() {
  return {
    url: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

// Built lazily (only when actually extracting from Linx) so bootstrap mode
// works without Linx credentials present.
function getLinxConfig() {
  return {
    server: requireEnv("LINX_SQL_SERVER"),
    port: Number(process.env.LINX_SQL_PORT || 1433),
    database: requireEnv("LINX_SQL_DATABASE"),
    user: requireEnv("LINX_SQL_USER"),
    password: requireEnv("LINX_SQL_PASSWORD"),
    encrypt: /^true$/i.test(process.env.LINX_SQL_ENCRYPT || "false"),
    filial: process.env.LINX_FILIAL || "LACOSTE SHOPPING  MANAUS",
  };
}

export const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// ---------------------------------------------------------------------------
// Encoding repair for double-encoded Linx source text.
//
// A few PRODUTOS text values arrive already mojibake'd in Linx itself: UTF-8
// bytes that were once decoded as Windows-1252 and re-encoded as UTF-8, so one
// real accented char shows up as two garbage chars (e.g. LINHA "BONÉS" stored
// as "BONÃ‰S", "PARKAS & BLUSÕES" as "PARKAS & BLUSÃ•ES"). The mssql driver,
// this script and Supabase all carry the bytes faithfully — clean values in
// the SAME column ("CALÇA", "ACESSÓRIOS", "BLUSÃO") prove the pipeline is not
// the cause — so the correct place to normalise is here, at ingestion.
//
// This is the mechanical inverse of the double-encoding, NOT a table of
// known-bad words: re-encode the string to its Windows-1252 bytes and decode
// them as UTF-8. It is applied to a value ONLY when
//   (a) it carries the mojibake signature (Ã/Â immediately followed by
//       another non-ASCII char — plain accented text never has that pair),
//   (b) every char is representable as a single CP1252 byte,
//   (c) those bytes are valid UTF-8, and
//   (d) the result has fewer non-ASCII chars than the original (a real repair
//       collapses 2+ garbage chars back into 1).
// Any value failing a check is returned untouched. Idempotent — safe to run
// again over already-repaired text (e.g. the V2 bootstrap re-runs this over
// V1 snapshot rows that were already repaired once at V1 ingestion time).
//
// Applied only to employee-facing product text (desc_produto, tipo_produto,
// linha). NOT to cor_descricao_linx: that is internal Linx source metadata,
// part of the curated mapping key (cor_codigo, cor_descricao_linx), and is
// preserved exactly as Linx supplies it.
// ---------------------------------------------------------------------------

// CP1252 code points for bytes 0x80..0x9F — the only range where Windows-1252
// diverges from ISO-8859-1. 0x00..0xFF otherwise map to themselves.
const CP1252_HIGH_TO_BYTE = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

function countNonAscii(s) {
  let n = 0;
  for (const ch of s) if (ch.codePointAt(0) > 0x7f) n += 1;
  return n;
}

function hasMojibakeSignature(s) {
  const cps = Array.from(s, (ch) => ch.codePointAt(0));
  for (let i = 0; i < cps.length - 1; i += 1) {
    if ((cps[i] === 0xc2 || cps[i] === 0xc3) && cps[i + 1] > 0x7f) return true;
  }
  return false;
}

export function repairDoubleEncodedText(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (!hasMojibakeSignature(value)) return value;

  const bytes = [];
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    const byte = cp <= 0xff ? cp : CP1252_HIGH_TO_BYTE.get(cp);
    if (byte === undefined) return value;
    bytes.push(byte);
  }

  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return value;
  }

  return countNonAscii(decoded) < countNonAscii(value) ? decoded : value;
}

// ---------------------------------------------------------------------------
// Dash-only structural placeholder handling. Unchanged from V1 (locked
// 2026-09-10 decision) — content-based only, no hard-coded key/produto/grade
// list.
// ---------------------------------------------------------------------------
function isDashOnlyLabel(value) {
  return typeof value === "string" && /^-+$/.test(value.trim());
}

export function normalizeExtraction(rows) {
  const kept = [];
  const warnings = [];
  let excludedDashZero = 0;

  for (const r of rows) {
    const label = r.tamanho_venda == null ? "" : String(r.tamanho_venda).trim();
    if (isDashOnlyLabel(label)) {
      const qty = Number(r.quantidade_estoque);
      if (qty === 0) {
        excludedDashZero += 1;
        continue;
      }
      warnings.push(
        `Unexpected non-zero dash-only size label (row kept, not suppressed): ` +
          `produto=${String(r.produto).trim()} cor_codigo=${String(r.cor_codigo).trim()} ` +
          `tamanho_key=${r.tamanho_key} tamanho_venda="${label}" quantidade_estoque=${qty}`,
      );
    }
    kept.push(r);
  }

  return { rows: kept, excludedDashZero, warnings };
}

// ---------------------------------------------------------------------------
// Finalization: mojibake repair + trimming + numeric coercion. Runs AFTER
// normalizeExtraction and BEFORE validation/hashing/staging, so every
// downstream consumer (validateExtraction, the hash engine, the staged
// payload) sees the exact same canonical row shape. Unchanged in substance
// from V1's inline `text`/`raw` payload mapping — now a named, reusable,
// exported function so both the live sync and the bootstrap path (and the
// diff-engine tests) apply it identically.
// ---------------------------------------------------------------------------
export function finalizeCanonicalRow(r) {
  const text = (v) => (v == null ? null : repairDoubleEncodedText(String(v).trim()));
  const raw = (v) => (v == null ? null : String(v).trim());
  return {
    produto: String(r.produto).trim(),
    desc_produto: text(r.desc_produto),
    tipo_produto: text(r.tipo_produto),
    linha: text(r.linha),
    cor_codigo: String(r.cor_codigo).trim(),
    cor_descricao_linx: raw(r.cor_descricao_linx),
    grade: r.grade == null ? null : String(r.grade).trim(),
    tamanho_key: Number(r.tamanho_key),
    tamanho_venda: r.tamanho_venda == null ? null : String(r.tamanho_venda).trim(),
    quantidade_estoque: Number(r.quantidade_estoque),
  };
}

// ---------------------------------------------------------------------------
// Local validation of the (already normalized + finalized) canonical rows.
// Unchanged rules from V1.
// ---------------------------------------------------------------------------
export function validateExtraction(rows) {
  const problems = [];
  if (rows.length === 0) problems.push("extraction returned 0 rows");

  const REQUIRED_TEXT = ["produto", "cor_codigo"];
  const seen = new Set();
  let dupKeys = 0;
  let missingKeys = 0;
  let missingLabel = 0;
  let badQty = 0;
  let negativeSizes = 0;

  for (const r of rows) {
    for (const f of REQUIRED_TEXT) {
      if (r[f] == null || String(r[f]).trim() === "") missingKeys++;
    }
    const tk = Number(r.tamanho_key);
    if (!Number.isInteger(tk) || tk < 1 || tk > 48) missingKeys++;

    if (r.tamanho_venda == null || String(r.tamanho_venda).trim() === "") missingLabel++;

    const q = Number(r.quantidade_estoque);
    if (!Number.isInteger(q)) badQty++;
    else if (q < 0) negativeSizes++;

    const key = `${String(r.produto).trim()}|${String(r.cor_codigo).trim()}|${tk}`;
    if (seen.has(key)) dupKeys++;
    else seen.add(key);
  }

  if (missingKeys) problems.push(`${missingKeys} row(s) with an empty/invalid canonical key field`);
  if (missingLabel)
    problems.push(
      `${missingLabel} row(s) with a null/blank tamanho_venda — only applicable ` +
        `labelled grade positions may be published`,
    );
  if (badQty) problems.push(`${badQty} row(s) with a non-integer quantidade_estoque`);
  if (dupKeys) problems.push(`${dupKeys} duplicate (produto, cor_codigo, tamanho_key) row(s)`);

  // Locked decision (Joshua, 2026-09-09): negative size-level quantities are
  // expected to be zero and there is NO normalization rule. If any appear,
  // STOP and report the count rather than assuming a fix.
  if (negativeSizes > 0) {
    problems.push(
      `${negativeSizes} size-level NEGATIVE quantity row(s) found — no normalization rule exists; ` +
        `stopping so Joshua can decide how to handle them`,
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    stats: {
      linhas: rows.length,
      produtos: new Set(rows.map((r) => String(r.produto).trim())).size,
      produto_cores: new Set(
        rows.map((r) => `${String(r.produto).trim()}|${String(r.cor_codigo).trim()}`),
      ).size,
      tamanhos_positivos: rows.filter((r) => Number(r.quantidade_estoque) > 0).length,
      tamanhos_zero: rows.filter((r) => Number(r.quantidade_estoque) === 0).length,
      tamanhos_negativos: negativeSizes,
      tamanhos_sem_label: missingLabel,
      max_tamanho_key: rows.reduce((m, r) => Math.max(m, Number(r.tamanho_key) || 0), 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Extraction sources
// ---------------------------------------------------------------------------
async function extractFromLinx(sql) {
  const linx = getLinxConfig();
  const query = readFileSync(join(HERE, "linx-query.sql"), "utf8");
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

  const result = await pool.request().input("filial", sql.VarChar, linx.filial).query(query);
  await pool.close();
  return result.recordset ?? [];
}

// One-time bootstrap source (V2 brief section 22): reads the latest
// successful V1 estoque_snapshot instead of Linx, so V2's current state can
// be seeded and read-parity-tested against a known V1 state before any real
// Linx-sourced V2 sync runs. Reuses the SAME normalize/finalize/validate/
// hash/diff/stage/apply pipeline as a live run — bootstrap is not a special
// code path beyond where its rows come from.
async function extractFromV1Snapshot(supabase) {
  const { data: execRows, error: execErr } = await supabase
    .from("estoque_sync_execucoes")
    .select("id,concluido_em")
    .eq("status", "sucesso")
    .not("concluido_em", "is", null)
    .order("concluido_em", { ascending: false })
    .limit(1);
  if (execErr)
    throw new Error(`bootstrap: could not read estoque_sync_execucoes: ${execErr.message}`);
  if (!execRows || execRows.length === 0) {
    throw new Error("bootstrap: no successful V1 sync execution found in estoque_sync_execucoes");
  }
  const v1SyncId = execRows[0].id;
  log(`bootstrap source: V1 sync_id=${v1SyncId} (concluido_em=${execRows[0].concluido_em})`);

  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("estoque_snapshot")
      .select(
        "produto,desc_produto,tipo_produto,linha,cor_codigo,cor_descricao_linx,grade,tamanho_key,tamanho_venda,quantidade_estoque",
      )
      .eq("sync_id", v1SyncId)
      .order("id", { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);
    if (error) throw new Error(`bootstrap: could not read estoque_snapshot: ${error.message}`);
    rows.push(...data);
    if (data.length < READ_PAGE_SIZE) break;
    from += READ_PAGE_SIZE;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Supabase RPC / table helpers
// ---------------------------------------------------------------------------
async function claimSync(supabase) {
  const { data, error } = await supabase.rpc("estoque_claim_sync");
  if (error) throw new Error(`estoque_claim_sync failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

async function markErro(supabase, syncId, mensagem, errorCode) {
  if (!syncId) return;
  const { error } = await supabase.rpc("estoque_marcar_erro", {
    p_sync_id: syncId,
    p_mensagem: mensagem,
    p_error_code: errorCode ?? null,
  });
  if (error) throw new Error(`estoque_marcar_erro failed: ${error.message}`);
  log(`marked execution ${syncId} as erro (error_code=${errorCode ?? "none"})`);
}

async function fetchCurrentHashes(supabase) {
  const map = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("estoque_atual_grupos")
      .select("produto,cor_codigo,hash_conteudo,row_count")
      .order("produto", { ascending: true })
      .order("cor_codigo", { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);
    if (error) throw new Error(`could not read estoque_atual_grupos: ${error.message}`);
    for (const row of data) {
      map.set(groupKey(row.produto, row.cor_codigo), row);
    }
    if (data.length < READ_PAGE_SIZE) break;
    from += READ_PAGE_SIZE;
  }
  return map;
}

function toStagingLine(syncId, r) {
  return {
    sync_id: syncId,
    produto: r.produto,
    cor_codigo: r.cor_codigo,
    tamanho_key: r.tamanho_key,
    desc_produto: r.desc_produto,
    tipo_produto: r.tipo_produto,
    linha: r.linha,
    cor_descricao_linx: r.cor_descricao_linx,
    grade: r.grade,
    tamanho_venda: r.tamanho_venda,
    quantidade_estoque: r.quantidade_estoque,
  };
}

async function stageChanges(supabase, syncId, diff) {
  const manifestRows = [];
  const lineRows = [];

  for (const g of diff.novo) {
    manifestRows.push({
      sync_id: syncId,
      produto: g.produto,
      cor_codigo: g.cor_codigo,
      acao: "novo",
      hash_conteudo: g.hash,
      row_count_esperado: g.row_count,
    });
    for (const r of g.rows) lineRows.push(toStagingLine(syncId, r));
  }
  for (const g of diff.alterado) {
    manifestRows.push({
      sync_id: syncId,
      produto: g.produto,
      cor_codigo: g.cor_codigo,
      acao: "alterado",
      hash_conteudo: g.hash,
      row_count_esperado: g.row_count,
    });
    for (const r of g.rows) lineRows.push(toStagingLine(syncId, r));
  }
  for (const g of diff.removido) {
    manifestRows.push({
      sync_id: syncId,
      produto: g.produto,
      cor_codigo: g.cor_codigo,
      acao: "removido",
      hash_conteudo: null,
      row_count_esperado: null,
    });
  }

  for (let i = 0; i < manifestRows.length; i += CHUNK_SIZE) {
    const chunk = manifestRows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("estoque_staging_grupos").insert(chunk);
    if (error) throw new Error(`staging manifest insert failed at offset ${i}: ${error.message}`);
  }
  for (let i = 0; i < lineRows.length; i += CHUNK_SIZE) {
    const chunk = lineRows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("estoque_staging_linhas").insert(chunk);
    if (error) throw new Error(`staging rows insert failed at offset ${i}: ${error.message}`);
  }

  log(
    `staged ${manifestRows.length} group manifest row(s) ` +
      `(${diff.novo.length} novo, ${diff.alterado.length} alterado, ${diff.removido.length} removido), ` +
      `${lineRows.length} inventory row(s)`,
  );
}

async function applySync(supabase, params) {
  const { data, error } = await supabase.rpc("estoque_aplicar_sync", {
    p_sync_id: params.syncId,
    p_raw_rows: params.rawRows,
    p_canonical_rows: params.canonicalRows,
    p_produto_count: params.produtoCount,
    p_produto_cor_count: params.produtoCorCount,
    p_avisos: params.avisos,
    p_allow_large_removal: params.allowLargeRemoval,
    p_override_reason: params.overrideReason,
  });
  if (error) throw new Error(`estoque_aplicar_sync failed: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function printBanner() {
  const modes = [];
  if (DRY_RUN) modes.push("DRY-RUN — preview only, no claim/stage/apply, no durable writes");
  if (BOOTSTRAP_V2)
    modes.push(
      "BOOTSTRAP-V2-FROM-V1 — one-time seed source is the latest V1 estoque_snapshot, NOT Linx",
    );
  if (ALLOW_LARGE_REMOVAL)
    modes.push(
      `ALLOW-LARGE-REMOVAL — the >10% removal guardrail may be overridden this run` +
        (OVERRIDE_REASON ? ` (reason: "${OVERRIDE_REASON}")` : " (NO --override-reason GIVEN)"),
    );
  if (modes.length === 0) return;
  log("=".repeat(78));
  log("NONSTANDARD MODE(S) ACTIVE FOR THIS RUN:");
  for (const m of modes) log(`  - ${m}`);
  log("=".repeat(78));
}

function printDiffSummary({
  rawRows,
  canonicalRows,
  currentGroups,
  incomingGroups,
  diff,
  removalPct,
  warningsCount,
}) {
  const changedRows = [...diff.novo, ...diff.alterado].reduce((sum, g) => sum + g.row_count, 0);
  log("--- diff summary ---");
  log(`raw rows:                  ${rawRows}`);
  log(`canonical rows:            ${canonicalRows}`);
  log(`current groups:            ${currentGroups}`);
  log(`incoming groups:           ${incomingGroups}`);
  log(`new groups:                ${diff.novo.length}`);
  log(`changed groups:            ${diff.alterado.length}`);
  log(`removed groups:            ${diff.removido.length}`);
  log(`unchanged groups:          ${diff.inalterado}`);
  log(`changed/new rows to stage: ${changedRows}`);
  log(`removal %:                 ${removalPct.toFixed(3)}%`);
  log(`warnings:                  ${warningsCount}`);
  log(
    `override requested:        ${
      ALLOW_LARGE_REMOVAL
        ? `yes${OVERRIDE_REASON ? ` ("${OVERRIDE_REASON}")` : " (no reason given)"}`
        : "no"
    }`,
  );
  log("--------------------");
}

// ---------------------------------------------------------------------------
async function runDryRun(supabase, sql) {
  const rawRows = BOOTSTRAP_V2 ? await extractFromV1Snapshot(supabase) : await extractFromLinx(sql);
  log(`extraction: ${rawRows.length} raw rows`);

  const norm = normalizeExtraction(rawRows);
  if (norm.excludedDashZero > 0) {
    log(`excluded ${norm.excludedDashZero} dash-only zero-stock placeholder row(s)`);
  }
  for (const w of norm.warnings) log(`WARNING: ${w}`);

  const canonicalRows = norm.rows.map(finalizeCanonicalRow);
  const v = validateExtraction(canonicalRows);
  log("extraction stats:", JSON.stringify(v.stats));
  if (Math.abs(v.stats.linhas - RECONCILE_BASELINE) > RECONCILE_BASELINE * 0.15) {
    log(
      `WARNING: canonical rows (${v.stats.linhas}) differ from the reconciliation baseline ` +
        `(${RECONCILE_BASELINE}) by more than 15%. Expected with assortment/grade changes — ` +
        `verify it reflects real movement, not a query/connection fault.`,
    );
  }
  if (!v.ok) {
    console.error(`\nDRY RUN — local validation FAILED:\n  - ${v.problems.join("\n  - ")}\n`);
    process.exitCode = 1;
    return;
  }
  log("local validation: PASS");

  const incomingGroups = hashAllGroups(canonicalRows);
  const currentHashes = await fetchCurrentHashes(supabase);
  const diff = diffGroups(incomingGroups, currentHashes);
  const removalPct = currentHashes.size > 0 ? (diff.removido.length / currentHashes.size) * 100 : 0;

  printDiffSummary({
    rawRows: rawRows.length,
    canonicalRows: canonicalRows.length,
    currentGroups: currentHashes.size,
    incomingGroups: incomingGroups.size,
    diff,
    removalPct,
    warningsCount: norm.warnings.length,
  });

  if (removalPct > 10 && !ALLOW_LARGE_REMOVAL) {
    log(
      `NOTE: a REAL run right now would be BLOCKED by the >10% removal guardrail ` +
        `(would need --allow-large-removal).`,
    );
  } else if (removalPct >= 5) {
    log(
      `NOTE: a REAL run right now would succeed but emit a high-visibility removal warning (5-10% band).`,
    );
  }

  log("dry run complete — nothing staged, claimed, or applied.");
}

async function runReal(supabase, sql) {
  const claim = await claimSync(supabase);
  if (!claim.claimed) {
    log(`SKIPPED — sync already in progress (motivo=${claim.motivo}). No mutation performed.`);
    if (claim.execucao_anterior_recuperada) {
      log(
        `(note: a stale execution ${claim.execucao_anterior_recuperada} was recovered/marked erro ` +
          `during this claim attempt)`,
      );
    }
    return;
  }

  const syncId = claim.sync_id;
  log(
    `claimed sync ${syncId}` +
      (claim.execucao_anterior_recuperada
        ? ` (recovered abandoned execution ${claim.execucao_anterior_recuperada})`
        : ""),
  );

  try {
    const rawRows = BOOTSTRAP_V2
      ? await extractFromV1Snapshot(supabase)
      : await extractFromLinx(sql);
    log(`extraction: ${rawRows.length} raw rows`);

    const norm = normalizeExtraction(rawRows);
    if (norm.excludedDashZero > 0) {
      log(`excluded ${norm.excludedDashZero} dash-only zero-stock placeholder row(s)`);
    }
    for (const w of norm.warnings) log(`WARNING: ${w}`);

    const canonicalRows = norm.rows.map(finalizeCanonicalRow);
    const v = validateExtraction(canonicalRows);
    log("extraction stats:", JSON.stringify(v.stats));
    if (Math.abs(v.stats.linhas - RECONCILE_BASELINE) > RECONCILE_BASELINE * 0.15) {
      log(
        `WARNING: canonical rows (${v.stats.linhas}) differ from the reconciliation baseline ` +
          `(${RECONCILE_BASELINE}) by more than 15%. Expected with assortment/grade changes — ` +
          `verify it reflects real movement, not a query/connection fault.`,
      );
    }
    if (!v.ok) {
      const msg = `local validation failed:\n  - ${v.problems.join("\n  - ")}`;
      await markErro(supabase, syncId, msg, "EXTRACTION_FATAL");
      console.error(`\nSYNC FAILED:\n${msg}\n`);
      process.exitCode = 1;
      return;
    }
    log("local validation: PASS");

    const incomingGroups = hashAllGroups(canonicalRows);
    const currentHashes = await fetchCurrentHashes(supabase);
    const diff = diffGroups(incomingGroups, currentHashes);
    const removalPct =
      currentHashes.size > 0 ? (diff.removido.length / currentHashes.size) * 100 : 0;

    printDiffSummary({
      rawRows: rawRows.length,
      canonicalRows: canonicalRows.length,
      currentGroups: currentHashes.size,
      incomingGroups: incomingGroups.size,
      diff,
      removalPct,
      warningsCount: norm.warnings.length,
    });

    if (removalPct >= 5 && removalPct <= 10) {
      log(
        `HIGH-VISIBILITY WARNING: removal ${removalPct.toFixed(3)}% (${diff.removido.length} of ` +
          `${currentHashes.size} groups) is in the 5-10% warning band. The sync may still apply.`,
      );
    }
    if (removalPct > 10 && !ALLOW_LARGE_REMOVAL) {
      log(
        `GUARDRAIL: removal ${removalPct.toFixed(3)}% exceeds 10% — this run WILL BE BLOCKED by ` +
          `estoque_aplicar_sync unless re-run with --allow-large-removal.`,
      );
    }
    if (ALLOW_LARGE_REMOVAL) {
      log(
        `NOTICE: --allow-large-removal is set for this run` +
          (OVERRIDE_REASON ? ` (reason: "${OVERRIDE_REASON}")` : " (NO --override-reason GIVEN)") +
          `. This does not bypass any other validation.`,
      );
    }

    await stageChanges(supabase, syncId, diff);

    const produtoCount = new Set(canonicalRows.map((r) => r.produto)).size;
    const produtoCorCount = incomingGroups.size;

    const result = await applySync(supabase, {
      syncId,
      rawRows: rawRows.length,
      canonicalRows: canonicalRows.length,
      produtoCount,
      produtoCorCount,
      avisos: norm.warnings,
      allowLargeRemoval: ALLOW_LARGE_REMOVAL,
      overrideReason: ALLOW_LARGE_REMOVAL ? OVERRIDE_REASON : null,
    });

    if (result.status === "sucesso") {
      log(
        `SUCCESS — sync ${syncId}: novo=${result.grupos_novos} alterado=${result.grupos_alterados} ` +
          `removido=${result.grupos_removidos} inalterado=${result.grupos_inalterados} ` +
          `linhas_escritas=${result.linhas_escritas} remocao=${result.remocao_percentual}% ` +
          `freshness=${result.concluido_em}` +
          (norm.warnings.length ? ` — ${norm.warnings.length} warning(s)` : ""),
      );
    } else {
      console.error(
        `\nSYNC BLOCKED/FAILED — status=${result.status} error_code=${result.error_code}\n` +
          `${result.mensagem}\n`,
      );
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err?.message ?? String(err);
    try {
      await markErro(supabase, syncId, message, "UNEXPECTED_ERROR");
    } catch (markErr) {
      log(`WARNING: could not mark execution erro: ${markErr?.message ?? markErr}`);
    }
    console.error(`\nSYNC FAILED:\n${message}\n`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  printBanner();

  const [{ default: sql }, { createClient }] = await Promise.all([
    import("mssql"),
    import("@supabase/supabase-js"),
  ]);

  const supabaseConfig = getSupabaseConfig();
  const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (DRY_RUN) {
    await runDryRun(supabase, sql);
  } else {
    await runReal(supabase, sql);
  }

  log(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  process.exit(process.exitCode ?? 0);
}

// Entry-point guard: this file exports pure functions (normalizeExtraction,
// finalizeCanonicalRow, validateExtraction, requireEnv, log) that other
// scripts import for testing/diagnostics (test-diff-engine.mjs). Without
// this guard, merely IMPORTING this module would unconditionally trigger a
// real claim/extract/stage/apply run as a side effect — main() only runs
// when this file is the actual process entry point.
const isDirectEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntryPoint) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
