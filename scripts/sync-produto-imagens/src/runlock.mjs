// Single-instance guard for scheduled publication runs (Trello #10).
//
// A lock file is created atomically (flag "wx"). If it already exists the
// holder is checked: a live process younger than `staleMs` keeps the lock; a
// dead process, or a lock older than `staleMs` (PID reuse / hung run that the
// runtime limit should already have ended), is taken over. Correctness never
// depends on this lock: uploads are immutable and activation is transactional,
// so an overlap would only waste work. The lock just prevents that.

import fs from "node:fs";

export function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM"; // exists but not ours; ESRCH means gone
  }
}

function readHolder(file) {
  try {
    const holder = JSON.parse(fs.readFileSync(file, "utf8"));
    return Number.isInteger(holder?.pid) && Number.isFinite(holder?.startedAt) ? holder : null;
  } catch {
    return null; // missing or corrupt (e.g. crash while writing) → treat as stale
  }
}

/**
 * @returns {{ acquired: true, release: () => void } | { acquired: false, holder: object }}
 */
export function acquireRunLock(
  file,
  { staleMs, now = Date.now, pid = process.pid, isAlive = defaultIsAlive },
) {
  const body = () => JSON.stringify({ pid, startedAt: now() });
  const tryCreate = () => {
    try {
      fs.writeFileSync(file, body(), { flag: "wx" });
      return true;
    } catch (err) {
      if (err?.code === "EEXIST") return false;
      throw err;
    }
  };
  const release = () => {
    // Only remove our own lock, never one a later run took over.
    if (readHolder(file)?.pid === pid) fs.rmSync(file, { force: true });
  };

  if (tryCreate()) return { acquired: true, release };

  const holder = readHolder(file);
  const stale = !holder || !isAlive(holder.pid) || now() - holder.startedAt > staleMs;
  if (!stale) return { acquired: false, holder };

  fs.rmSync(file, { force: true });
  if (tryCreate()) return { acquired: true, release };
  return { acquired: false, holder: readHolder(file) ?? {} }; // lost the takeover race
}
