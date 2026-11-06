import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addSkip,
  avaliarFrescor,
  chunk,
  diversificar,
  escolherLote,
  loadSkip,
  parseLoteArgs,
  toProdutosArg,
} from "../src/lote-selecao.mjs";

const row = (produto, cor, total) => ({
  produto,
  cor_codigo: cor,
  estoque_total: total,
  sync_concluido_em: "2026-11-06T10:00:00Z",
});

test("parseLoteArgs: dry-run by default, bounded target and round", () => {
  assert.deepEqual(parseLoteArgs([]), { persist: false, limit: 25, round: 25 });
  assert.deepEqual(parseLoteArgs(["--persist", "--limit=250"]), {
    persist: true,
    limit: 250,
    round: 25,
  });
  assert.equal(parseLoteArgs(["--limit=10", "--round=5"]).round, 5);
  assert.throws(() => parseLoteArgs(["--limit=0"]));
  assert.throws(() => parseLoteArgs(["--limit=501"]));
  assert.throws(() => parseLoteArgs(["--limit=abc"]));
  assert.throws(() => parseLoteArgs(["--round=51"]));
  assert.throws(() => parseLoteArgs(["--persist", "--dry-run"]));
});

test("avaliarFrescor: fresh within the window, stale beyond it or when unparseable", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  assert.equal(avaliarFrescor("2026-11-06T10:00:00Z", { now }).fresh, true);
  assert.equal(avaliarFrescor("2026-11-04T10:00:00Z", { now }).fresh, false);
  assert.equal(avaliarFrescor("2026-11-04T10:00:00Z", { now, maxHoras: 72 }).fresh, true);
  assert.equal(avaliarFrescor("não é data", { now }).fresh, false);
  assert.equal(avaliarFrescor("2026-11-07T10:00:00Z", { now }).fresh, false); // future
});

test("escolherLote: keeps stock order, drops duplicates and skipped, caps at limit", () => {
  const now = 1_000;
  const rows = [row("A", "01", 90), row("A", "01", 90), row("B", "02", 50), row("C", "03", 40)];
  const { chosen, skipped } = escolherLote(rows, { "B:02": now + 1 }, { limit: 2, now });
  assert.deepEqual(
    chosen.map((c) => `${c.produto}:${c.cor_codigo}`),
    ["A:01", "C:03"],
  );
  assert.equal(skipped, 1);
});

test("diversificar: at most 2 colours per product per pass, stock order preserved", () => {
  const rows = [
    row("A", "1", 9),
    row("A", "2", 8),
    row("A", "3", 7),
    row("B", "1", 6),
    row("C", "1", 5),
  ];
  assert.deepEqual(
    diversificar(rows).map((r) => `${r.produto}${r.cor_codigo}`),
    ["A1", "A2", "B1", "C1", "A3"],
  );
  assert.deepEqual(diversificar([]), []);
});

test("escolherLote: a dominant product cannot fill a whole round", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row("TOP", `c${i}`, 100 - i)),
    ...Array.from({ length: 6 }, (_, i) => row(`P${i}`, "01", 50 - i)),
  ];
  const { chosen } = escolherLote(rows, {}, { limit: 8 });
  assert.equal(new Set(chosen.map((c) => c.produto)).size, 7);
  assert.equal(chosen.filter((c) => c.produto === "TOP").length, 2);
});

test("escolherLote: combinations tried in this run are never selected again (no infinite loop)", () => {
  const rows = [row("A", "1", 9), row("B", "1", 8)];
  const exclude = new Set(["A:1"]);
  const { chosen, eligible } = escolherLote(rows, {}, { limit: 5, exclude });
  assert.deepEqual(
    chosen.map((c) => c.produto),
    ["B"],
  );
  assert.equal(eligible, 1);
  assert.equal(
    escolherLote(rows, {}, { limit: 5, exclude: new Set(["A:1", "B:1"]) }).chosen.length,
    0,
  );
});

test("escolherLote: an expired skip entry no longer excludes", () => {
  const { chosen } = escolherLote([row("B", "02", 5)], { "B:02": 500 }, { limit: 5, now: 1_000 });
  assert.equal(chosen.length, 1);
});

test("chunk and toProdutosArg build bounded REF:COR lists", () => {
  const items = Array.from({ length: 12 }, (_, i) => row(`P${i}`, "01", 1));
  assert.deepEqual(
    chunk(items).map((c) => c.length),
    [5, 5, 2],
  );
  assert.equal(toProdutosArg(items.slice(0, 2)), "P0:01,P1:01");
});

test("skip list persists, expires and tolerates a missing/corrupt file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lote-"));
  const file = path.join(dir, "sub", "ignorados.json");
  assert.deepEqual(loadSkip(file), {});
  addSkip(file, [{ produto: "X", cor_codigo: "9" }], { now: 1_000, days: 1 });
  assert.ok(loadSkip(file, 1_001)["X:9"] > 1_001);
  assert.deepEqual(loadSkip(file, 1_000 + 86_400_000 + 1), {});
  fs.writeFileSync(file, "{corrupt");
  assert.deepEqual(loadSkip(file), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migration: read-only, service_role-only, excludes existing work", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(
    path.join(
      dir,
      "../../../supabase/migrations/20261106_001_add_listar_cores_estoque_sem_imagem.sql",
    ),
    "utf8",
  );
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(
    sql,
    /revoke all on function public\.listar_cores_estoque_sem_imagem\(integer\) from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public\.listar_cores_estoque_sem_imagem\(integer\) to service_role/,
  );
  assert.match(sql, /not exists \(select 1 from public\.produto_imagem_candidatos/);
  assert.match(sql, /p\.status in \('pendente', 'ativa'\)/);
  assert.match(sql, /having pg_catalog\.sum\(e\.quantidade_estoque\) > 0/);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\b\s+(into|public|from)/i);
});
