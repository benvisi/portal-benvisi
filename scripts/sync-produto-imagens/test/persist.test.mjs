import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseArgs } from "../src/args.mjs";
import { buildPersistParams } from "../src/scoring.mjs";

const root = new URL("../../../", import.meta.url);
const migration = fs.readFileSync(
  new URL("supabase/migrations/20261007_002_add_registrar_pontuacao_candidato.sql", root),
  "utf8",
);
const sig = "public.registrar_pontuacao_candidato(uuid, text, text, text, text, jsonb, text[])";

test("migration: security definer, fixed search_path, narrow grants", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  for (const role of ["public", "anon", "authenticated"])
    assert.ok(migration.includes(`revoke all on function ${sig} from ${role};`), role);
  assert.ok(migration.includes(`grant execute on function ${sig} to service_role;`));
  assert.doesNotMatch(
    migration,
    /grant\s+(update|all)[^;]*on\s+(table\s+)?public\.produto_imagem_candidatos/i,
  );
  assert.doesNotMatch(migration, /create policy/i);
});

test("migration: UPDATE touches only scoring columns and only pending rows", () => {
  const upd = migration.slice(migration.indexOf("update public.produto_imagem_candidatos"));
  const setClause = upd.slice(upd.indexOf("set"), upd.indexOf("where"));
  const cols = [...setClause.matchAll(/(\w+)\s*=/g)].map((m) => m[1]);
  assert.deepEqual(cols.sort(), [
    "limitacoes",
    "primary_candidate_reason",
    "primary_candidate_url",
    "scoring_notes",
    "secondary_candidate_reason",
    "secondary_candidate_url",
  ]);
  assert.match(upd, /status = 'pendente'/);
});

test("args: persist is opt-in; dry-run default has persist=false", () => {
  assert.equal(parseArgs(["--produtos=A:B"]).persist, false);
  assert.equal(parseArgs(["--produtos=A:B", "--persist"]).persist, true);
});

test("args: persist without --produtos is refused (no catalog-wide scoring)", () => {
  assert.throws(() => parseArgs(["--persist"]));
});

test("args: over-limit input is flagged truncated", () => {
  const r = parseArgs(["--produtos=A:1,B:2,C:3", "--limit=2", "--persist"]);
  assert.equal(r.truncated, true);
});

const scored = (primary, secondary) => ({
  result: { images: [{ index: 0 }], primary, secondary, confidence: "high", limitations: ["l"] },
});

test("persist params carry URLs, reasons, notes without image payloads", () => {
  const p = buildPersistParams(
    "id1",
    scored(
      { index: 0, url: "https://h/a.jpg", reason: "r1" },
      { index: null, url: null, reason: "none" },
    ),
    { model: "m", usage: { input_tokens: 1, output_tokens: 2 }, imageCount: 1 },
  );
  assert.equal(p.p_primary_url, "https://h/a.jpg");
  assert.equal(p.p_secondary_url, null);
  assert.equal(p.p_secondary_reason, null);
  assert.deepEqual(p.p_limitacoes, ["l"]);
  assert.equal(p.p_scoring_notes.model, "m");
  assert.doesNotMatch(JSON.stringify(p), /base64/);
});

test("no-primary result persists null primary with explanation in notes", () => {
  const p = buildPersistParams(
    "id1",
    scored(
      { index: null, url: null, reason: "nothing qualifies" },
      { index: null, url: null, reason: "" },
    ),
    { model: "m", usage: {}, imageCount: 1 },
  );
  assert.equal(p.p_primary_url, null);
  assert.equal(p.p_scoring_notes.no_primary_reason, "nothing qualifies");
});

test("score.mjs: RPC call only reachable under persist; dry-run default", () => {
  const src = fs.readFileSync(new URL("src/score.mjs", new URL("../", import.meta.url)), "utf8");
  assert.equal((src.match(/registrarPontuacao\(/g) || []).length, 1);
  assert.match(src, /if \(persist\) \{\s*await registrarPontuacao/);
  assert.match(src, /maxRetries: 0/);
});
