// Static guards on the retry-limits migration. Behaviour is covered by
// supabase/tests/produto_imagem_publicacao_retry.sql, which needs a database
// and is not run by this suite.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../../../", import.meta.url);
const sql = fs.readFileSync(
  new URL("supabase/migrations/20261103_001_add_produto_imagem_publicacao_retry_limits.sql", root),
  "utf8",
);

test("adds only nullable bookkeeping columns, no new status", () => {
  assert.match(sql, /add column proxima_tentativa_em timestamptz/);
  assert.match(sql, /add column falha_permanente_em timestamptz/);
  assert.doesNotMatch(sql, /status in \(/);
});

test("every function is security definer with an empty search_path", () => {
  const fns = sql.split(/create or replace function /).slice(1);
  assert.equal(fns.length, 3);
  for (const f of fns) {
    assert.match(f, /security definer/, f.slice(0, 60));
    assert.match(f, /set search_path = ''/, f.slice(0, 60));
  }
});

test("worker queue skips permanent failures and rows still backing off", () => {
  assert.match(sql, /p\.falha_permanente_em is null/);
  assert.match(
    sql,
    /p\.proxima_tentativa_em is null or p\.proxima_tentativa_em <= pg_catalog\.now\(\)/,
  );
  assert.match(sql, /where p\.status = 'pendente'\s+and c\.status = 'aprovado'/);
});

test("failure recording gives up on the 5th attempt and backs off before that", () => {
  assert.match(sql, /when tentativas \+ 1 >= 5 then pg_catalog\.now\(\)/);
  assert.match(sql, /least\(15 \* pg_catalog\.power\(4, tentativas\), 360\)/);
  assert.match(sql, /and falha_permanente_em is null;/);
});

test("requeue is service_role only and limited to pending publications", () => {
  assert.match(
    sql,
    /revoke all on function public\.reenfileirar_publicacao_imagem\(uuid\) from public, anon, authenticated;/,
  );
  assert.match(
    sql,
    /grant execute on function public\.reenfileirar_publicacao_imagem\(uuid\) to service_role;/,
  );
  assert.doesNotMatch(sql, /to anon|to authenticated/);
  assert.match(sql, /PUBLICACAO_NAO_PENDENTE/);
});

test("does not touch RLS, table privileges or the approval functions", () => {
  assert.doesNotMatch(sql, /disable row level security|grant (select|insert|update|delete)/i);
  assert.doesNotMatch(sql, /aprovar_candidato_imagem|rejeitar_candidato_imagem/);
});
