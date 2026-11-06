// Pure helpers for the stock-prioritized batch (`npm run lote`): snapshot
// freshness, the local "not found on Lacoste" skip list, and chunking. No I/O
// except the small skip-list file, so everything is unit-testable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LIMIT = 25; // target of scored candidates for the whole run
export const MAX_LIMIT = 500;
export const DEFAULT_ROUND = 25; // combinations selected per round
export const MAX_ROUND = 50;
export const PER_PRODUCT_PER_PASS = 2; // diversity: colours of one product per pass
export const MAX_EMPTY_CHUNKS = 3; // consecutive chunks with nothing acquired => abort
export const CHUNK_SIZE = 5; // acquire.mjs / score.mjs hard cap per run
export const DEFAULT_MAX_STOCK_AGE_HOURS = 36;
export const DEFAULT_SKIP_DAYS = 3;

export const keyOf = (produto, cor) => `${produto}:${cor}`;

export function parseLoteArgs(argv) {
  const flags = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  const persist = flags.persist === true;
  if (persist && flags["dry-run"] === true)
    throw new Error("--dry-run and --persist are mutually exclusive");
  let limit = DEFAULT_LIMIT;
  if (flags.limit !== undefined) {
    limit = Number.parseInt(flags.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      throw new Error(
        `--limit must be an integer between 1 and ${MAX_LIMIT}, got "${flags.limit}"`,
      );
  }
  let round = DEFAULT_ROUND;
  if (flags.round !== undefined) {
    round = Number.parseInt(flags.round, 10);
    if (!Number.isInteger(round) || round < 1 || round > MAX_ROUND)
      throw new Error(
        `--round must be an integer between 1 and ${MAX_ROUND}, got "${flags.round}"`,
      );
  }
  return { persist, limit, round };
}

/** Returns { fresh, ageHours } for the stock snapshot completion time. */
export function avaliarFrescor(
  concluidoEm,
  { now = Date.now(), maxHoras = DEFAULT_MAX_STOCK_AGE_HOURS } = {},
) {
  const ts = Date.parse(concluidoEm);
  if (Number.isNaN(ts)) return { fresh: false, ageHours: Infinity };
  const ageHours = (now - ts) / 3_600_000;
  return { fresh: ageHours >= 0 && ageHours <= maxHoras, ageHours };
}

/**
 * Diversity rule: walk the stock-ordered rows in passes, taking at most `perPass`
 * colours of each product per pass. Products keep the order of their highest-stock
 * colour, so stock still drives priority but no product can fill a whole round.
 */
export function diversificar(rows, perPass = PER_PRODUCT_PER_PASS) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.produto)) groups.set(row.produto, []);
    groups.get(row.produto).push(row);
  }
  const out = [];
  while (out.length < rows.length) {
    for (const group of groups.values()) out.push(...group.splice(0, perPass));
  }
  return out;
}

/**
 * Drops duplicates, recently-not-found combinations (`skip`) and combinations
 * already tried in this run (`exclude`), applies the diversity rule, caps at `limit`.
 */
export function escolherLote(rows, skip, { limit, now = Date.now(), exclude = new Set() }) {
  const seen = new Set();
  const eligible = [];
  let skipped = 0;
  for (const row of rows) {
    const key = keyOf(row.produto, row.cor_codigo);
    if (seen.has(key)) continue;
    seen.add(key);
    if (exclude.has(key)) continue;
    const until = skip[key];
    if (until !== undefined && until > now) {
      skipped += 1;
      continue;
    }
    eligible.push(row);
  }
  return { chosen: diversificar(eligible).slice(0, limit), skipped, eligible: eligible.length };
}

export function chunk(items, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const toProdutosArg = (items) =>
  items.map((i) => keyOf(i.produto, i.cor_codigo ?? i.cor)).join(",");

export function defaultSkipFile(env = process.env) {
  return (
    env.LOTE_SKIP_FILE ||
    path.join(env.LOCALAPPDATA || os.tmpdir(), "PortalBenvisi", "lote-imagens-ignorados.json")
  );
}

export function loadSkip(file, now = Date.now()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.fromEntries(Object.entries(data).filter(([, until]) => until > now));
  } catch {
    return {};
  }
}

export function addSkip(file, items, { now = Date.now(), days = DEFAULT_SKIP_DAYS } = {}) {
  const skip = loadSkip(file, now);
  for (const i of items) skip[keyOf(i.produto, i.cor_codigo ?? i.cor)] = now + days * 86_400_000;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(skip, null, 2));
}
