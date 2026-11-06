// Single-instance guard for scheduled publication runs (Trello #10).
//
// A lock file is created atomically (flag "wx") and records the owner's PID.
//
//   * A lock whose owner process is ALIVE is never taken over, however old it
//     is: a live holder ends itself (run limit) or is killed by the wrapper's
//     outer limit, so age is not evidence of death. If a PID was reused by an
//     unrelated process after a crash, the lock stays until someone deletes it
//     (the refusal message names the file) - a safe failure: no overlap.
//   * A lock whose owner is dead is taken over.
//   * An unreadable lock is treated as dead only after a short grace period,
//     because a live run may have created the file but not written it yet.
//   * Takeover is serialized by an exclusive guard directory, so two runs that
//     both see a dead owner cannot both win.
//
// Correctness never depends on this lock: uploads are immutable and activation
// is transactional, so an overlap would only waste work.

import fs from "node:fs";

const UNREADABLE_GRACE_MS = 10_000;
const GUARD_STALE_MS = 60_000;

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
    return null;
  }
}

const sameHolder = (a, b) => a?.pid === b?.pid && a?.startedAt === b?.startedAt;

function ageOf(path, now) {
  try {
    return now() - fs.statSync(path).mtimeMs;
  } catch {
    return Infinity; // vanished
  }
}

/**
 * @returns {{ acquired: true, release: () => void } | { acquired: false, holder: object, file: string }}
 */
export function acquireRunLock(
  file,
  { now = Date.now, pid = process.pid, isAlive = defaultIsAlive } = {},
) {
  const guard = `${file}.takeover`;
  const tryCreate = () => {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid, startedAt: now() }), { flag: "wx" });
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
  const refused = () => ({ acquired: false, holder: readHolder(file) ?? {}, file });
  const isStale = (holder) =>
    holder ? !isAlive(holder.pid) : ageOf(file, now) > UNREADABLE_GRACE_MS;

  if (tryCreate()) return { acquired: true, release };

  const seen = readHolder(file);
  if (!isStale(seen)) return refused();

  // Serialize takeover. A guard left by a crash within this tiny window is
  // cleared after GUARD_STALE_MS.
  const enter = () => {
    try {
      fs.mkdirSync(guard);
      return true;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      if (ageOf(guard, now) > GUARD_STALE_MS) {
        fs.rmSync(guard, { recursive: true, force: true });
        return enter();
      }
      return false;
    }
  };
  if (!enter()) return refused();
  try {
    // Re-check under the guard: the lock may have been replaced meanwhile.
    const current = readHolder(file);
    if (!sameHolder(current, seen) || !isStale(current)) return refused();
    fs.rmSync(file, { force: true });
    return tryCreate() ? { acquired: true, release } : refused();
  } finally {
    fs.rmSync(guard, { recursive: true, force: true });
  }
}
