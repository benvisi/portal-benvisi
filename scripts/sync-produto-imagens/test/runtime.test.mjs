import test from "node:test";
import assert from "node:assert/strict";
import { readRuntimeConfig, startRunDeadline, TimeoutError, withTimeout } from "../src/runtime.mjs";

test("config defaults and overrides", () => {
  const d = readRuntimeConfig({});
  assert.equal(d.maxRuntimeMs, 20 * 60_000);
  assert.equal(d.itemTimeoutMs, 180_000);
  assert.match(d.lockFile, /portal-benvisi-publicar\.lock$/);
  const c = readRuntimeConfig({
    PUBLICAR_MAX_RUNTIME_MIN: "5",
    PUBLICAR_ITEM_TIMEOUT_SEC: "30",
    PUBLICAR_LOCK_FILE: "D:\\locks\\x.lock",
  });
  assert.equal(c.maxRuntimeMs, 300_000);
  assert.equal(c.itemTimeoutMs, 30_000);
  assert.equal(c.lockFile, "D:\\locks\\x.lock");
});

test("config rejects non-positive or non-numeric limits", () => {
  assert.throws(() => readRuntimeConfig({ PUBLICAR_MAX_RUNTIME_MIN: "0" }), /positive/);
  assert.throws(() => readRuntimeConfig({ PUBLICAR_ITEM_TIMEOUT_SEC: "abc" }), /positive/);
});

test("withTimeout passes through results and errors", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 1000, "x"), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 1000, "x"), /boom/);
});

test("withTimeout rejects a hung operation with TimeoutError", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 20, "item"),
    (err) => err instanceof TimeoutError && /item/.test(err.message),
  );
});

test("run deadline: soft handler fires, then hard handler after the grace period", async () => {
  const events = [];
  startRunDeadline({
    maxMs: 20,
    graceMs: 20,
    onSoft: () => events.push("soft"),
    onHard: () => events.push("hard"),
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(events, ["soft", "hard"]);
});

test("run deadline can be cancelled by a run that finishes in time", async () => {
  const events = [];
  const stop = startRunDeadline({
    maxMs: 30,
    graceMs: 10,
    onSoft: () => events.push("soft"),
    onHard: () => events.push("hard"),
  });
  stop();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(events, []);
});
