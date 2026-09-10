#!/usr/bin/env node
// =============================================================================
// Consulta de Estoque — one-shot manual inventory sync (Linx -> Supabase)
//
// Proves one complete real Linx -> Supabase publish. Run manually from the
// on-prem Windows PC. No Task Scheduler, no cron — see the milestone brief.
//
//   node scripts/sync-estoque/sync-estoque.mjs            # full sync + publish
//   node scripts/sync-estoque/sync-estoque.mjs --dry-run  # extract + validate only
//
// Flow (brief section "Sync architecture"):
//   1. insert estoque_sync_execucoes row = 'executando'
//   2. query Linx SQL Server (scripts/sync-estoque/linx-query.sql)
//   3. validate locally: rows > 0, no duplicate canonical keys, required keys
//      populated, quantities parse as non-negative integers, no size-level
//      negatives (STOP + report count if any — no silent normalization)
//   4. publish all rows tagged with the new sync_id (chunked bulk insert)
//   5. validate Supabase row count + uniqueness for this sync_id
//   6. mark execution 'sucesso' with concluido_em, linhas_extraidas/publicadas
//   7. any failure -> mark execution 'erro'; the previous successful snapshot
//      is never touched
//
// Secrets come only from scripts/sync-estoque/.env (gitignored). Nothing is
// logged that could expose a credential.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const CHUNK_SIZE = 1000;
// Soft reconciliation baseline for the APPLICABLE-grade grain (one row per
// qualifying produto+cor+labelled size position). ~15 506 at the 2026-09-09
// inspection. Advisory only — a drift beyond +/-15% just logs a WARNING;
// assortment/grade changes over time are expected and must not be rejected.
const RECONCILE_BASELINE = 15506;

// ---------------------------------------------------------------------------
// Minimal .env loader (no dependency). KEY=VALUE lines, # comments, optional
// surrounding quotes. Only fills vars not already set in the environment.
// ---------------------------------------------------------------------------
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

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`ERROR: missing required env var ${name} (set it in scripts/sync-estoque/.env)`);
    process.exit(2);
  }
  return v.trim();
}

const CONFIG = {
  linx: {
    server: requireEnv("LINX_SQL_SERVER"),
    port: Number(process.env.LINX_SQL_PORT || 1433),
    database: requireEnv("LINX_SQL_DATABASE"),
    user: requireEnv("LINX_SQL_USER"),
    password: requireEnv("LINX_SQL_PASSWORD"),
    encrypt: /^true$/i.test(process.env.LINX_SQL_ENCRYPT || "false"),
    filial: process.env.LINX_FILIAL || "LACOSTE SHOPPING  MANAUS",
  },
  supabase: {
    url: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  },
};

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

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
// Any value failing a check is returned untouched. Idempotent.
//
// Applied only to employee-facing product text (desc_produto, tipo_produto,
// linha). NOT to cor_descricao_linx: that is internal Linx source metadata,
// part of the curated mapping key (cor_codigo, cor_descricao_linx), and is
// preserved exactly as Linx supplies it (it is never shown to employees, and
// current diagnostics found it clean). Lossy source corruption that is not
// mechanically reversible (e.g. "CALÇA" stored as "CALÃA", a dropped byte) is
// deliberately left alone — check (a) declines it.
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

// A char 0xC3 ("Ã") or 0xC2 ("Â") immediately followed by another non-ASCII
// char is the hallmark of one accented char that became two. Plain accented
// text ("SAO"->"SÃO", "CALCA"->"CALÇA", "ACESSORIOS"->"ACESSÓRIOS") never has
// that adjacency.
function hasMojibakeSignature(s) {
  const cps = Array.from(s, (ch) => ch.codePointAt(0));
  for (let i = 0; i < cps.length - 1; i += 1) {
    if ((cps[i] === 0xc2 || cps[i] === 0xc3) && cps[i + 1] > 0x7f) return true;
  }
  return false;
}

function repairDoubleEncodedText(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (!hasMojibakeSignature(value)) return value;

  const bytes = [];
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    const byte = cp <= 0xff ? cp : CP1252_HIGH_TO_BYTE.get(cp);
    if (byte === undefined) return value; // not a single CP1252 byte -> leave as-is
    bytes.push(byte);
  }

  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return value; // bytes are not valid UTF-8 -> not this kind of mojibake
  }

  return countNonAscii(decoded) < countNonAscii(value) ? decoded : value;
}

// ---------------------------------------------------------------------------
// Dash-only structural placeholder handling.
//
// A few Linx grades carry size labels that are just dash characters ("-",
// "--", "---") — placeholder positions, not real sizes. In the current
// dataset every one of them has quantidade_estoque = 0.
//
// Rule (content-based only — NO hard-coded tamanho_key / produto / grade
// list, so a position that later gets a real label such as "XXS", "38" or
// "9,5" automatically flows through unchanged):
//   * trimmed tamanho_venda matches /^-+$/  AND  quantidade_estoque === 0
//       -> drop the row from the canonical snapshot
//   * trimmed tamanho_venda matches /^-+$/  AND  quantidade_estoque !== 0
//       -> KEEP the row (never lose stock), and emit a prominent WARNING.
//         This must NOT fail the sync or freeze the feed — the Portal
//         prefers resilience over blocking the whole stock feed for one
//         source anomaly. Proactive notification of warnings is future
//         scheduled-sync work.
// Blank/null labels are still handled upstream (linx-query.sql only emits
// labelled positions) and by validateExtraction below.
// ---------------------------------------------------------------------------
function isDashOnlyLabel(value) {
  return typeof value === "string" && /^-+$/.test(value.trim());
}

function normalizeExtraction(rows) {
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
// Local validation of the extracted rows.
// ---------------------------------------------------------------------------
function validateExtraction(rows) {
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
    // tamanho_key is internal ordering metadata: any 1..48 source position is
    // valid — there is no hard-coded Portal maximum grade size.
    const tk = Number(r.tamanho_key);
    if (!Number.isInteger(tk) || tk < 1 || tk > 48) missingKeys++;

    // Every published row must be an APPLICABLE / LABELLED grade position.
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
async function main() {
  const [{ default: sql }, { createClient }] = await Promise.all([
    import("mssql"),
    import("@supabase/supabase-js"),
  ]);

  const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- 1. open execution row ------------------------------------------------
  let execId = null;
  if (!DRY_RUN) {
    const { data, error } = await supabase
      .from("estoque_sync_execucoes")
      .insert({ status: "executando" })
      .select("id")
      .single();
    if (error) throw new Error(`could not open estoque_sync_execucoes row: ${error.message}`);
    execId = data.id;
    log(`opened sync execution ${execId} (status=executando)`);
  } else {
    log("dry run — no estoque_sync_execucoes row will be written");
  }

  try {
    // -- 2. extract from Linx --------------------------------------------
    const query = readFileSync(join(HERE, "linx-query.sql"), "utf8");
    log(
      `connecting to Linx SQL Server ${CONFIG.linx.server}:${CONFIG.linx.port} / ${CONFIG.linx.database} ...`,
    );
    const pool = await sql.connect({
      server: CONFIG.linx.server,
      port: CONFIG.linx.port,
      database: CONFIG.linx.database,
      user: CONFIG.linx.user,
      password: CONFIG.linx.password,
      options: {
        encrypt: CONFIG.linx.encrypt,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      requestTimeout: 180_000,
      pool: { max: 1 },
    });

    const result = await pool
      .request()
      .input("filial", sql.VarChar, CONFIG.linx.filial)
      .query(query);
    await pool.close();

    const rawRows = result.recordset ?? [];
    log(`Linx extraction: ${rawRows.length} raw rows`);

    // -- 3. normalize (dash-only placeholders) + validate locally ------
    const norm = normalizeExtraction(rawRows);
    const rows = norm.rows;
    if (norm.excludedDashZero > 0) {
      log(
        `excluded ${norm.excludedDashZero} dash-only zero-stock placeholder row(s) ` +
          `from the canonical snapshot`,
      );
    }
    for (const w of norm.warnings) log(`WARNING: ${w}`);
    log(
      `canonical extraction: ${rows.length} rows` +
        (norm.warnings.length ? ` — ${norm.warnings.length} warning(s)` : ""),
    );

    const v = validateExtraction(rows);
    log("extraction stats:", JSON.stringify(v.stats));
    if (Math.abs(v.stats.linhas - RECONCILE_BASELINE) > RECONCILE_BASELINE * 0.15) {
      log(
        `WARNING: applicable-grade rows (${v.stats.linhas}) differ from the reconciliation ` +
          `baseline (${RECONCILE_BASELINE}) by more than 15%. Expected with assortment/grade ` +
          `changes — verify it reflects real movement, not a query/connection fault.`,
      );
    }
    if (!v.ok) {
      throw new Error(`local validation failed:\n  - ${v.problems.join("\n  - ")}`);
    }
    log("local validation: PASS");

    if (DRY_RUN) {
      log(
        `dry run complete — nothing published. raw=${rawRows.length} ` +
          `canonical=${rows.length} excluded_dash_zero=${norm.excludedDashZero} ` +
          `warnings=${norm.warnings.length}`,
      );
      return;
    }

    // -- 4. publish ----------------------------------------------------
    // Employee-facing product text passes through repairDoubleEncodedText (see
    // top of file) — a few Linx source values arrive double-encoded. Codes
    // (produto, cor_codigo, grade, tamanho_venda) and cor_descricao_linx (the
    // curated-mapping key metadata) are left exactly as Linx supplies them.
    const text = (v) => (v == null ? null : repairDoubleEncodedText(String(v).trim()));
    const raw = (v) => (v == null ? null : String(v).trim());
    const payload = rows.map((r) => ({
      sync_id: execId,
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
    }));

    let published = 0;
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const chunk = payload.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase.from("estoque_snapshot").insert(chunk);
      if (error) throw new Error(`bulk insert failed at offset ${i}: ${error.message}`);
      published += chunk.length;
      if (i % (CHUNK_SIZE * 10) === 0 || published === payload.length) {
        log(`published ${published}/${payload.length}`);
      }
    }

    // -- 5. verify what landed ---------------------------------------
    const { count: landed, error: countErr } = await supabase
      .from("estoque_snapshot")
      .select("id", { count: "exact", head: true })
      .eq("sync_id", execId);
    if (countErr) throw new Error(`could not count published rows: ${countErr.message}`);
    if (landed !== payload.length) {
      throw new Error(
        `published ${payload.length} rows but Supabase holds ${landed} for this sync_id`,
      );
    }
    // Uniqueness is guaranteed by the unique (sync_id, produto, cor_codigo,
    // tamanho_key) constraint — a violation would have aborted an insert
    // chunk above. The count match confirms every extracted row landed once.
    log(`Supabase confirms ${landed} rows for sync_id ${execId} (matches extraction)`);

    // -- 6. mark success -------------------------------------------
    const { error: doneErr } = await supabase
      .from("estoque_sync_execucoes")
      .update({
        status: "sucesso",
        concluido_em: new Date().toISOString(),
        // canonical (post-normalization) count; raw Linx count and the
        // dash-only exclusions are in the run log
        linhas_extraidas: rows.length,
        linhas_publicadas: published,
        erro: null,
      })
      .eq("id", execId);
    if (doneErr) throw new Error(`could not mark execution sucesso: ${doneErr.message}`);

    log(
      `SUCCESS — sync ${execId} published ${published} rows` +
        (norm.warnings.length ? ` with ${norm.warnings.length} warning(s)` : "") +
        ` and is now the visible snapshot.`,
    );
  } catch (err) {
    // -- 7. mark failure; leave the previous successful snapshot intact --
    const message = err?.message ?? String(err);
    if (execId) {
      await supabase
        .from("estoque_sync_execucoes")
        .update({
          status: "erro",
          concluido_em: new Date().toISOString(),
          erro: message.slice(0, 4000),
        })
        .eq("id", execId)
        .then(
          () => log(`marked execution ${execId} as erro`),
          (e) => log(`WARNING: could not mark execution erro: ${e?.message ?? e}`),
        );
    }
    console.error("\nSYNC FAILED:\n" + message + "\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
