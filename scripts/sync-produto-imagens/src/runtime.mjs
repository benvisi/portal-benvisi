// Runtime limits for scheduled publication runs (Trello #10): configuration
// parsing, a per-item timeout and a two-stage whole-run deadline.

import os from "node:os";
import path from "node:path";

function positiveNumber(raw, fallback, name) {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

export function readRuntimeConfig(env = process.env) {
  const maxRuntimeMin = positiveNumber(
    env.PUBLICAR_MAX_RUNTIME_MIN,
    20,
    "PUBLICAR_MAX_RUNTIME_MIN",
  );
  const itemTimeoutSec = positiveNumber(
    env.PUBLICAR_ITEM_TIMEOUT_SEC,
    180,
    "PUBLICAR_ITEM_TIMEOUT_SEC",
  );
  return {
    maxRuntimeMs: maxRuntimeMin * 60_000,
    itemTimeoutMs: itemTimeoutSec * 1000,
    // The lock is considered stale after the longest legitimate run plus slack.
    lockStaleMs: maxRuntimeMin * 60_000 + 5 * 60_000,
    lockFile: env.PUBLICAR_LOCK_FILE || path.join(os.tmpdir(), "portal-benvisi-publicar.lock"),
  };
}

export class TimeoutError extends Error {}

export async function withTimeout(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label}: excedeu ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whole-run deadline. At `maxMs` the soft handler runs (close the browser,
 * finish cleanly); if the process is still alive `graceMs` later, the hard
 * handler runs (release the lock and exit).
 */
export function startRunDeadline({ maxMs, graceMs = 30_000, onSoft, onHard }) {
  let hard;
  const soft = setTimeout(() => {
    Promise.resolve()
      .then(onSoft)
      .catch(() => {});
    hard = setTimeout(onHard, graceMs);
    hard.unref?.();
  }, maxMs);
  soft.unref?.();
  return () => {
    clearTimeout(soft);
    clearTimeout(hard);
  };
}
