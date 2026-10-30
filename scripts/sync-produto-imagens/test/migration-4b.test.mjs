// Static guards on the Slice 4B migration. Behaviour is covered by
// supabase/tests/produto_imagem_aprovacao_publicacao.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../../', import.meta.url);
const sql = fs.readFileSync(new URL('supabase/migrations/20261030_001_add_produto_imagem_aprovacao_publicacao.sql', root), 'utf8');

const BROWSER = [
  'get_produto_imagens_permissao(text)',
  'get_candidatos_imagem_pendentes(text)',
  'aprovar_candidato_imagem(text, uuid, integer, integer, text, boolean)',
  'rejeitar_candidato_imagem(text, uuid, text)',
  'revogar_publicacao_imagem(text, uuid, text)',
  'get_produto_imagens_publicadas(text, text)',
];
const WORKER = [
  'listar_publicacoes_imagem_pendentes(integer)',
  'registrar_envio_arquivo_publicacao(uuid, text, text, integer, integer, integer)',
  'ativar_publicacao_imagem(uuid)',
  'registrar_falha_publicacao_imagem(uuid, text)',
];

test('every function is security definer with an empty search_path', () => {
  const fns = sql.split(/create or replace function /).slice(1);
  assert.ok(fns.length >= 14);
  for (const f of fns) {
    assert.match(f, /set search_path = ''/, f.slice(0, 60));
  }
  const definers = sql.match(/security definer/g) ?? [];
  assert.equal(definers.length, BROWSER.length + WORKER.length + 1); // + exigir_gestor helper
});

test('browser RPCs: anon only; worker RPCs: service_role only', () => {
  for (const f of BROWSER) {
    assert.ok(sql.includes(`grant execute on function public.${f} to anon;`), f);
    assert.ok(sql.includes(`revoke all on function public.${f} from public, authenticated, service_role;`), f);
  }
  for (const f of WORKER) {
    assert.ok(sql.includes(`grant execute on function public.${f} to service_role;`), f);
    assert.ok(sql.includes(`revoke all on function public.${f} from public, anon, authenticated;`), f);
  }
});

test('no table grants, no policies, RLS enabled on new tables', () => {
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete|all)[^;]*\son\s+(table\s+)?public\./i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /alter table public\.produto_imagem_publicacoes enable row level security/);
  assert.match(sql, /alter table public\.produto_imagem_publicacao_arquivos enable row level security/);
});

test('human_reviewed is never read', () => {
  assert.doesNotMatch(sql.replace(/^\s*--.*$/gm, ''), /human_reviewed/);
});

test('single active and single pending set per product/colour', () => {
  assert.match(sql, /produto_imagem_publicacoes_ativa_uidx[\s\S]*?where status = 'ativa'/);
  assert.match(sql, /produto_imagem_publicacoes_pendente_uidx[\s\S]*?where status = 'pendente'/);
});
