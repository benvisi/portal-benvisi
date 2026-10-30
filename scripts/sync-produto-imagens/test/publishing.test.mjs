import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  assertPublishableSource, assertStoragePath, toWebp, uploadImmutable,
  publishPublication, planPublication, sha256,
} from '../src/publishing.mjs';
import { parsePublishArgs } from '../src/publish.mjs';

const PUB_ID = '11111111-2222-3333-4444-555555555555';
const SRC = (n) => `https://imagesa1.lacoste.com/dw/image/v2/BCWL_PRD/on/demandware.static/-/Sites-master/default/dw83764cac/NF2142AA_A91_${n}.jpg`;
const pub = (over = {}) => ({
  publicacao_id: PUB_ID, produto: 'NF2142AA', cor_codigo: 'A91', tentativas: 0,
  arquivos: [
    { arquivo_id: 'a1', slot: 'principal', source_url: SRC(24), storage_path: `NF2142AA/A91/${PUB_ID}/principal.webp`, content_sha256: null },
    { arquivo_id: 'a2', slot: 'secundaria', source_url: SRC(34), storage_path: `NF2142AA/A91/${PUB_ID}/secundaria.webp`, content_sha256: null },
  ],
  ...over,
});

const bigPng = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#fff' } }).png().toBuffer();
const smallPng = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#000' } }).png().toBuffer();

// In-memory bucket that behaves like Supabase Storage with upsert:false.
function fakeStorage({ failUploadFor } = {}) {
  const objects = new Map();
  return {
    objects,
    uploads: [],
    async upload(path, data, opts) {
      this.uploads.push({ path, opts });
      if (failUploadFor === path) return { error: { message: 'network down' } };
      if (objects.has(path)) return { error: { statusCode: '409', message: 'The resource already exists' } };
      objects.set(path, Buffer.from(data));
      return { error: null };
    },
    async download(path) {
      const b = objects.get(path);
      return b ? { data: { arrayBuffer: async () => b }, error: null } : { data: null, error: { message: 'not found' } };
    },
  };
}
function fakeRpc() {
  const calls = [];
  const fn = async (name, params) => { calls.push({ name, params }); return { error: null }; };
  fn.calls = calls;
  return fn;
}

test('source integrity: requires lacoste host, version token and colour code', () => {
  assertPublishableSource(SRC(24), 'A91');
  assert.throws(() => assertPublishableSource('https://imagesa1.lacoste.com/x/NF2142AA_A91_24.jpg', 'A91'), /versão/);
  assert.throws(() => assertPublishableSource(SRC(24), '02H'), /cor aprovada/);
  assert.throws(() => assertPublishableSource('https://lacoste.com.evil.com/dw83764cac/NF2142AA_A91_24.jpg', 'A91'));
  assert.throws(() => assertPublishableSource('http://imagesa1.lacoste.com/dw83764cac/NF2142AA_A91_24.jpg', 'A91'));
});

test('storage path must be exactly the database-assigned immutable path', () => {
  const p = pub();
  assertStoragePath(p, p.arquivos[0]);
  assert.throws(() => assertStoragePath(p, { ...p.arquivos[0], storage_path: '../x/principal.webp' }));
  assert.throws(() => assertStoragePath(p, { ...p.arquivos[0], storage_path: `NF2142AA/A91/${PUB_ID}/secundaria.webp` }));
});

test('toWebp: webp, longest edge 1200, never enlarges, deterministic', async () => {
  const big = await toWebp(bigPng);
  assert.equal(big.width, 1200);
  assert.equal(big.height, 800);
  assert.equal((await sharp(big.data).metadata()).format, 'webp');
  const small = await toWebp(smallPng);
  assert.equal(small.width, 400);
  assert.equal(sha256((await toWebp(bigPng)).data), sha256(big.data));
});

test('toWebp rejects non-image input', async () => {
  await assert.rejects(toWebp(Buffer.from('<html>blocked</html>')));
});

test('uploadImmutable never overwrites: identical existing object accepted, different refused', async () => {
  const s = fakeStorage();
  const a = Buffer.from('A'); const b = Buffer.from('B');
  assert.equal(await uploadImmutable(s, 'p', a, sha256(a)), 'enviado');
  assert.equal(s.uploads[0].opts.upsert, false);
  assert.equal(await uploadImmutable(s, 'p', a, sha256(a)), 'já existia (idêntico)');
  await assert.rejects(uploadImmutable(s, 'p', b, sha256(b)), /não sobrescrito/);
  assert.equal(s.objects.get('p').toString(), 'A');
});

test('happy path: uploads both slots, records each, activates once at the end', async () => {
  const storage = fakeStorage(); const rpc = fakeRpc();
  const r = await publishPublication(pub(), { fetchSource: async () => bigPng, storage, rpc });
  assert.equal(r.status, 'ativada');
  assert.deepEqual(rpc.calls.map((c) => c.name), ['registrar_envio_arquivo_publicacao', 'registrar_envio_arquivo_publicacao', 'ativar_publicacao_imagem']);
  const rec = rpc.calls[0].params;
  assert.equal(rec.p_source_sha256, sha256(bigPng));
  assert.equal(rec.p_width, 1200);
  assert.equal(storage.objects.size, 2);
});

test('partial failure: secondary upload fails -> failure recorded, no activation', async () => {
  const storage = fakeStorage({ failUploadFor: `NF2142AA/A91/${PUB_ID}/secundaria.webp` }); const rpc = fakeRpc();
  const r = await publishPublication(pub(), { fetchSource: async () => bigPng, storage, rpc });
  assert.equal(r.status, 'falha');
  assert.deepEqual(rpc.calls.map((c) => c.name), ['registrar_envio_arquivo_publicacao', 'registrar_falha_publicacao_imagem']);
});

test('retry resumes: already-recorded primary is skipped, only secondary uploaded, then activated', async () => {
  const storage = fakeStorage(); const rpc = fakeRpc();
  const p = pub();
  p.arquivos[0].content_sha256 = 'f'.repeat(64);
  const fetched = [];
  const r = await publishPublication(p, { fetchSource: async (u) => { fetched.push(u); return bigPng; }, storage, rpc });
  assert.equal(r.status, 'ativada');
  assert.deepEqual(fetched, [SRC(34)]);
  assert.deepEqual(storage.uploads.map((u) => u.path), [`NF2142AA/A91/${PUB_ID}/secundaria.webp`]);
});

test('crash between upload and record: re-run finds identical object and records it', async () => {
  const storage = fakeStorage(); const rpc = fakeRpc();
  storage.objects.set(`NF2142AA/A91/${PUB_ID}/principal.webp`, (await toWebp(bigPng)).data);
  const r = await publishPublication(pub(), { fetchSource: async () => bigPng, storage, rpc });
  assert.equal(r.status, 'ativada');
  assert.equal(r.arquivos[0].resultado, 'já existia (idêntico)');
});

test('source changed since upload: existing object differs -> refused, not overwritten, not activated', async () => {
  const storage = fakeStorage(); const rpc = fakeRpc();
  const path = `NF2142AA/A91/${PUB_ID}/principal.webp`;
  storage.objects.set(path, Buffer.from('old bytes'));
  const r = await publishPublication(pub(), { fetchSource: async () => bigPng, storage, rpc });
  assert.equal(r.status, 'falha');
  assert.match(r.erro, /não sobrescrito/);
  assert.equal(storage.objects.get(path).toString(), 'old bytes');
  assert.ok(!rpc.calls.some((c) => c.name === 'ativar_publicacao_imagem'));
});

test('blocked/inaccessible source -> failure recorded, nothing uploaded', async () => {
  const storage = fakeStorage(); const rpc = fakeRpc();
  const r = await publishPublication(pub(), { fetchSource: async () => { throw new Error('image http 403'); }, storage, rpc });
  assert.equal(r.status, 'falha');
  assert.match(r.erro, /403/);
  assert.equal(storage.uploads.length, 0);
  assert.equal(rpc.calls.at(-1).name, 'registrar_falha_publicacao_imagem');
});

test('unversioned source URL is refused before any download', async () => {
  const storage = fakeStorage(); const rpc = fakeRpc();
  const p = pub(); p.arquivos[0].source_url = 'https://imagesa1.lacoste.com/x/NF2142AA_A91_24.jpg';
  let fetched = false;
  const r = await publishPublication(p, { fetchSource: async () => { fetched = true; return bigPng; }, storage, rpc });
  assert.equal(r.status, 'falha');
  assert.equal(fetched, false);
});

test('set without a primary is refused', async () => {
  const rpc = fakeRpc();
  const p = pub(); p.arquivos = [p.arquivos[1]];
  const r = await publishPublication(p, { fetchSource: async () => bigPng, storage: fakeStorage(), rpc });
  assert.equal(r.status, 'falha');
});

test('activation error is surfaced as a failure', async () => {
  const storage = fakeStorage();
  const rpc = async (name) => ({ error: name === 'ativar_publicacao_imagem' ? { message: 'PUBLICACAO_NAO_PENDENTE' } : null });
  const r = await publishPublication(pub(), { fetchSource: async () => bigPng, storage, rpc });
  assert.equal(r.status, 'falha');
  assert.match(r.erro, /PUBLICACAO_NAO_PENDENTE/);
});

test('dry-run plan validates without fetching or writing', () => {
  const p = pub(); p.arquivos[1].source_url = 'https://imagesa1.lacoste.com/x/NF2142AA_A91_34.jpg';
  const plan = planPublication(p);
  assert.equal(plan.arquivos[0].problemas.length, 0);
  assert.equal(plan.arquivos[1].problemas.length, 1);
});

test('publish CLI args: dry-run default, explicit --persist, bounded limit', () => {
  assert.deepEqual(parsePublishArgs([]), { persist: false, limit: 5 });
  assert.equal(parsePublishArgs(['--persist']).persist, true);
  assert.throws(() => parsePublishArgs(['--persist', '--dry-run']));
  assert.throws(() => parsePublishArgs(['--limit=21']));
  assert.throws(() => parsePublishArgs(['--limit=0']));
});
