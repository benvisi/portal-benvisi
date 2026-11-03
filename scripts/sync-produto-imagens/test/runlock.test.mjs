import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireRunLock } from "../src/runlock.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runlock-")), "publicar.lock");
const STALE = 25 * 60_000;

test("first run acquires; a second concurrent run is refused", () => {
  const file = tmp();
  const a = acquireRunLock(file, { staleMs: STALE, pid: 111, isAlive: () => true });
  assert.equal(a.acquired, true);
  const b = acquireRunLock(file, { staleMs: STALE, pid: 222, isAlive: () => true });
  assert.equal(b.acquired, false);
  assert.equal(b.holder.pid, 111);
});

test("release frees the lock for the next run", () => {
  const file = tmp();
  const a = acquireRunLock(file, { staleMs: STALE, pid: 111 });
  a.release();
  assert.equal(fs.existsSync(file), false);
  assert.equal(acquireRunLock(file, { staleMs: STALE, pid: 222 }).acquired, true);
});

test("a lock left by a crashed (dead) process is taken over", () => {
  const file = tmp();
  acquireRunLock(file, { staleMs: STALE, pid: 111 });
  const b = acquireRunLock(file, { staleMs: STALE, pid: 222, isAlive: () => false });
  assert.equal(b.acquired, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 222);
});

test("a live-looking but expired lock (PID reuse / hung run) is taken over", () => {
  const file = tmp();
  let clock = 1_000_000;
  acquireRunLock(file, { staleMs: STALE, pid: 111, now: () => clock });
  clock += STALE + 1;
  const b = acquireRunLock(file, {
    staleMs: STALE,
    pid: 222,
    now: () => clock,
    isAlive: () => true,
  });
  assert.equal(b.acquired, true);
});

test("a corrupt lock file does not block forever", () => {
  const file = tmp();
  fs.writeFileSync(file, "{not json");
  assert.equal(acquireRunLock(file, { staleMs: STALE, pid: 222 }).acquired, true);
});

test("release never removes a lock another run took over", () => {
  const file = tmp();
  const a = acquireRunLock(file, { staleMs: STALE, pid: 111 });
  fs.writeFileSync(file, JSON.stringify({ pid: 222, startedAt: Date.now() }));
  a.release();
  assert.equal(fs.existsSync(file), true);
});

test("the real liveness check sees this process as alive", async () => {
  const { defaultIsAlive } = await import("../src/runlock.mjs");
  assert.equal(defaultIsAlive(process.pid), true);
});
