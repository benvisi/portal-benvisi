import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireRunLock, defaultIsAlive } from "../src/runlock.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runlock-")), "publicar.lock");
const age = (file, ms) => {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(file, t, t);
};

test("first run acquires; a second concurrent run is refused", () => {
  const file = tmp();
  const a = acquireRunLock(file, { pid: 111, isAlive: () => true });
  assert.equal(a.acquired, true);
  const b = acquireRunLock(file, { pid: 222, isAlive: () => true });
  assert.equal(b.acquired, false);
  assert.equal(b.holder.pid, 111);
  assert.equal(b.file, file);
});

test("release frees the lock for the next run", () => {
  const file = tmp();
  acquireRunLock(file, { pid: 111 }).release();
  assert.equal(fs.existsSync(file), false);
  assert.equal(acquireRunLock(file, { pid: 222 }).acquired, true);
});

test("a lock left by a crashed (dead) process is taken over", () => {
  const file = tmp();
  acquireRunLock(file, { pid: 111 });
  const b = acquireRunLock(file, { pid: 222, isAlive: () => false });
  assert.equal(b.acquired, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 222);
  assert.equal(fs.existsSync(`${file}.takeover`), false);
});

test("a lock whose owner is still alive is NEVER taken over, however old", () => {
  const file = tmp();
  let clock = 1_000_000;
  acquireRunLock(file, { pid: 111, now: () => clock });
  clock += 30 * 24 * 3_600_000; // a month later
  age(file, 30 * 24 * 3_600_000);
  const b = acquireRunLock(file, { pid: 222, now: () => clock, isAlive: () => true });
  assert.equal(b.acquired, false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 111);
});

test("a freshly created but still empty lock is not mistaken for a stale one", () => {
  const file = tmp();
  fs.writeFileSync(file, ""); // a live run between create and write
  const b = acquireRunLock(file, { pid: 222, isAlive: () => false });
  assert.equal(b.acquired, false);
});

test("an unreadable lock is recovered once it is clearly abandoned", () => {
  const file = tmp();
  fs.writeFileSync(file, "{not json");
  age(file, 60_000);
  assert.equal(acquireRunLock(file, { pid: 222 }).acquired, true);
});

test("takeover is serialized: a run that finds the guard held backs off", () => {
  const file = tmp();
  acquireRunLock(file, { pid: 111 });
  fs.mkdirSync(`${file}.takeover`); // another run is mid-takeover
  const b = acquireRunLock(file, { pid: 222, isAlive: () => false });
  assert.equal(b.acquired, false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 111);
});

test("a guard abandoned by a crash is cleared", () => {
  const file = tmp();
  acquireRunLock(file, { pid: 111 });
  fs.mkdirSync(`${file}.takeover`);
  age(`${file}.takeover`, 5 * 60_000);
  assert.equal(acquireRunLock(file, { pid: 222, isAlive: () => false }).acquired, true);
});

test("a lock replaced while deciding is not stolen", () => {
  const file = tmp();
  acquireRunLock(file, { pid: 111 });
  let calls = 0;
  const b = acquireRunLock(file, {
    pid: 222,
    isAlive: () => {
      // First call: 111 looks dead. Meanwhile 333 legitimately takes over.
      if (calls++ === 0) {
        fs.writeFileSync(file, JSON.stringify({ pid: 333, startedAt: Date.now() + 1 }));
        return false;
      }
      return true;
    },
  });
  assert.equal(b.acquired, false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 333);
});

test("release never removes a lock another run took over", () => {
  const file = tmp();
  const a = acquireRunLock(file, { pid: 111 });
  fs.writeFileSync(file, JSON.stringify({ pid: 222, startedAt: Date.now() }));
  a.release();
  assert.equal(fs.existsSync(file), true);
});

test("the real liveness check sees this process as alive and a bogus pid as dead", () => {
  assert.equal(defaultIsAlive(process.pid), true);
  assert.equal(defaultIsAlive(2 ** 22 - 3), false);
});
