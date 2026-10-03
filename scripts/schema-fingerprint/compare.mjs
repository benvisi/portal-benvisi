#!/usr/bin/env node
// =============================================================================
// Portal Benvisi — schema fingerprint comparison (offline, no DB access)
//
//   node scripts/schema-fingerprint/compare.mjs <reference.tsv> <candidate.tsv>
//        [--allowlist <file>]        (default: allowlist.tsv next to this script)
//   node scripts/schema-fingerprint/compare.mjs --summary <fingerprint.tsv>
//
// Inputs are TSV outputs of schema-fingerprint.sql (see README.md for the exact
// psql command). Exit codes: 0 = equivalent, 1 = divergent, 2 = invalid input.
//
// The digest algorithm here must stay byte-for-byte identical to the
// "digests" CTE in schema-fingerprint.sql: md5 over "object_key<TAB>value"
// lines sorted bytewise (Postgres COLLATE "C"), joined with "\n".
// =============================================================================

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

export const FORMAT_VERSION = "1";
export const COMPARED_SECTIONS = ["app", "platform"];
export const INFO_SECTION = "info";
const DIGEST_SECTION = "~digest";

const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const byteCompare = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const rowId = (r) => `${r.section}\t${r.category}\t${r.object_key}`;

export function parseFingerprint(text, label = "input") {
  const rows = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line === "") continue;
    const f = line.split("\t");
    if (f.length !== 4) {
      throw new Error(`${label}:${i + 1}: expected 4 tab-separated fields, got ${f.length}`);
    }
    rows.push({ section: f[0], category: f[1], object_key: f[2], value: f[3] });
  }
  return rows;
}

// Per section.category and per section ("section.*") digests, mirroring the SQL.
export function computeDigests(rows) {
  const detail = rows.filter((r) => r.section !== DIGEST_SECTION && r.section !== "meta");
  const groups = new Map();
  const sections = new Map();
  for (const r of detail) {
    const k = `${r.section}.${r.category}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
    if (!sections.has(r.section)) sections.set(r.section, []);
    sections.get(r.section).push(r);
  }
  const out = new Map();
  for (const [k, rs] of groups) {
    const sorted = [...rs].sort((a, b) => byteCompare(a.object_key, b.object_key));
    out.set(k, {
      count: rs.length,
      md5: md5(sorted.map((r) => `${r.object_key}\t${r.value}`).join("\n")),
    });
  }
  for (const [s, rs] of sections) {
    const sorted = [...rs].sort(
      (a, b) => byteCompare(a.category, b.category) || byteCompare(a.object_key, b.object_key),
    );
    out.set(`${s}.*`, {
      count: rs.length,
      md5: md5(sorted.map((r) => `${r.category}\t${r.object_key}\t${r.value}`).join("\n")),
    });
  }
  return out;
}

export function embeddedDigests(rows) {
  const out = new Map();
  for (const r of rows.filter((x) => x.section === DIGEST_SECTION)) {
    const m = /^count=(\d+)$/.exec(r.object_key);
    if (!m) throw new Error(`malformed digest row for ${r.category}: ${r.object_key}`);
    out.set(r.category, { count: Number(m[1]), md5: r.value });
  }
  return out;
}

// Returns { mode: "full" | "digest-only", digests } or throws on invalid input.
export function validateFingerprint(rows, label = "input") {
  const meta = new Map(
    rows.filter((r) => r.section === "meta").map((r) => [`${r.category}.${r.object_key}`, r.value]),
  );
  if (meta.get("format.version") !== FORMAT_VERSION) {
    throw new Error(
      `${label}: fingerprint format version is "${meta.get("format.version")}", expected "${FORMAT_VERSION}"`,
    );
  }
  if (meta.get("setting.search_path") !== "pg_catalog") {
    throw new Error(
      `${label}: generated with search_path "${meta.get("setting.search_path")}" instead of ` +
        `"pg_catalog" — SET LOCAL did not take effect. Re-run in a single transaction ` +
        "(psql --single-transaction), see README.md.",
    );
  }
  const embedded = embeddedDigests(rows);
  const hasDetail = rows.some((r) => r.section !== DIGEST_SECTION && r.section !== "meta");
  if (!hasDetail) {
    if (embedded.size === 0) throw new Error(`${label}: contains neither detail nor digest rows`);
    return { mode: "digest-only", digests: embedded };
  }
  const computed = computeDigests(rows);
  for (const [k, e] of embedded) {
    const c = computed.get(k) ?? { count: 0, md5: md5("") };
    if (c.count !== e.count || c.md5 !== e.md5) {
      throw new Error(
        `${label}: embedded digest for ${k} does not match its detail rows ` +
          `(embedded count=${e.count} ${e.md5}, recomputed count=${c.count} ${c.md5}) — ` +
          "file is truncated, edited, or was produced by a different fingerprint version",
      );
    }
  }
  return { mode: "full", digests: computed };
}

export function parseAllowlist(text, label = "allowlist") {
  const entries = new Map();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line.trim() === "" || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length !== 4 || f.some((x) => x.trim() === "")) {
      throw new Error(
        `${label}:${i + 1}: expected 4 non-empty tab-separated fields: section, category, object_key, reason`,
      );
    }
    const [section, category, object_key, reason] = f;
    if (!COMPARED_SECTIONS.includes(section)) {
      throw new Error(`${label}:${i + 1}: section must be one of ${COMPARED_SECTIONS.join(", ")}`);
    }
    const id = `${section}\t${category}\t${object_key}`;
    if (entries.has(id)) throw new Error(`${label}:${i + 1}: duplicate entry`);
    entries.set(id, { section, category, object_key, reason, used: false });
  }
  return entries;
}

// Object-level comparison of two full fingerprints.
export function compareFull(refRows, candRows, allowlist = new Map()) {
  const index = (rows) =>
    new Map(
      rows
        .filter((r) => COMPARED_SECTIONS.includes(r.section) || r.section === INFO_SECTION)
        .map((r) => [rowId(r), r]),
    );
  const ref = index(refRows);
  const cand = index(candRows);
  const ids = [...new Set([...ref.keys(), ...cand.keys()])].sort(byteCompare);
  const result = { divergent: [], allowed: [], info: [] };
  for (const id of ids) {
    const a = ref.get(id);
    const b = cand.get(id);
    let kind = null;
    if (!b) kind = "MISSING";
    else if (!a) kind = "EXTRA";
    else if (a.value !== b.value) kind = "CHANGED";
    if (!kind) continue;
    const r = a ?? b;
    const diff = {
      kind,
      section: r.section,
      category: r.category,
      object_key: r.object_key,
      reference: a?.value ?? null,
      candidate: b?.value ?? null,
    };
    if (r.section === INFO_SECTION) {
      result.info.push(diff);
      continue;
    }
    const entry = allowlist.get(id);
    if (entry) {
      entry.used = true;
      result.allowed.push({ ...diff, reason: entry.reason });
    } else {
      result.divergent.push(diff);
    }
  }
  result.staleAllowlist = [...allowlist.values()].filter((e) => !e.used);
  return result;
}

// Category-level comparison when at least one side has digests only.
export function compareDigests(refDigests, candDigests) {
  const keys = [...new Set([...refDigests.keys(), ...candDigests.keys()])].sort(byteCompare);
  const result = { divergent: [], allowed: [], info: [], staleAllowlist: [] };
  // A category with no rows is equivalent to an explicit count=0 digest.
  const empty = { count: 0, md5: md5("") };
  for (const k of keys) {
    if (k.endsWith(".*")) continue;
    const a = refDigests.get(k) ?? empty;
    const b = candDigests.get(k) ?? empty;
    if (a.count === b.count && a.md5 === b.md5) continue;
    const [section, category] = [k.slice(0, k.indexOf(".")), k.slice(k.indexOf(".") + 1)];
    const diff = {
      kind: "DIGEST",
      section,
      category,
      object_key: "(category digest)",
      reference: `count=${a.count} ${a.md5}`,
      candidate: `count=${b.count} ${b.md5}`,
    };
    (section === INFO_SECTION ? result.info : result.divergent).push(diff);
  }
  return result;
}

function formatDiff(d) {
  const head = `  ${d.kind.padEnd(8)} ${d.section}.${d.category}  ${d.object_key}`;
  const lines = [head];
  if (d.reason) lines.push(`           allowed: ${d.reason}`);
  if (d.reference !== null) lines.push(`           reference: ${d.reference}`);
  if (d.candidate !== null) lines.push(`           candidate: ${d.candidate}`);
  return lines.join("\n");
}

export function formatReport(result, { refLabel, candLabel, mode }) {
  const out = [];
  out.push(`Reference: ${refLabel}`);
  out.push(`Candidate: ${candLabel}`);
  out.push(`Comparison mode: ${mode}`);
  out.push("");
  for (const section of COMPARED_SECTIONS) {
    const ds = result.divergent.filter((d) => d.section === section);
    out.push(`[${section}] ${ds.length} divergence(s)`);
    for (const d of ds) out.push(formatDiff(d));
  }
  if (result.allowed.length) {
    out.push("", `[allowlisted] ${result.allowed.length} difference(s) accepted by allowlist`);
    for (const d of result.allowed) out.push(formatDiff(d));
  }
  if (result.info.length) {
    out.push("", `[info] ${result.info.length} informational difference(s) — never fail`);
    for (const d of result.info) out.push(`  ${d.kind.padEnd(8)} ${d.category}  ${d.object_key}`);
  }
  if (result.staleAllowlist.length) {
    out.push("", "[allowlist] entries that matched nothing (remove if no longer needed):");
    for (const e of result.staleAllowlist) {
      out.push(`  ${e.section}.${e.category}  ${e.object_key}`);
    }
  }
  if (mode === "digest-only") {
    out.push(
      "",
      "Note: digest-only comparison shows WHICH categories differ, not which objects.",
      "Re-run with full fingerprints on both sides (and the allowlist) for object-level detail.",
    );
  }
  out.push("", result.divergent.length === 0 ? "RESULT: EQUIVALENT" : "RESULT: DIVERGENT");
  return out.join("\n");
}

function loadFingerprint(path) {
  const rows = parseFingerprint(readFileSync(path, "utf8"), path);
  return { rows, ...validateFingerprint(rows, path) };
}

function main(argv) {
  if (argv[0] === "--summary" && argv.length === 2) {
    const fp = loadFingerprint(argv[1]);
    console.log(`${argv[1]} (${fp.mode})`);
    for (const k of [...fp.digests.keys()].sort(byteCompare)) {
      const d = fp.digests.get(k);
      console.log(`${k.padEnd(32)} count=${String(d.count).padEnd(6)} ${d.md5}`);
    }
    return 0;
  }
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--allowlist");
  if (positional.length !== 2) {
    console.error(
      "usage: compare.mjs <reference.tsv> <candidate.tsv> [--allowlist <file>]\n" +
        "       compare.mjs --summary <fingerprint.tsv>",
    );
    return 2;
  }
  const alIdx = argv.indexOf("--allowlist");
  const allowlistPath =
    alIdx >= 0 ? argv[alIdx + 1] : join(dirname(fileURLToPath(import.meta.url)), "allowlist.tsv");
  const allowlist = parseAllowlist(readFileSync(allowlistPath, "utf8"), allowlistPath);
  const [refPath, candPath] = positional;
  const ref = loadFingerprint(refPath);
  const cand = loadFingerprint(candPath);
  const mode = ref.mode === "full" && cand.mode === "full" ? "full" : "digest-only";
  const result =
    mode === "full"
      ? compareFull(ref.rows, cand.rows, allowlist)
      : compareDigests(ref.digests, cand.digests);
  console.log(formatReport(result, { refLabel: refPath, candLabel: candPath, mode }));
  return result.divergent.length === 0 ? 0 : 1;
}

const isDirectEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntryPoint) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(2);
  }
}
