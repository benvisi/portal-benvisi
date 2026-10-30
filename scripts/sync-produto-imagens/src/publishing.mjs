// Publication logic for approved product images (Trello #10, Slice 4B).
// Dependencies (source fetch, storage, RPC) are injected so the logic is
// testable without a browser, a bucket or a database.
//
// Only publications listed by listar_publicacoes_imagem_pendentes are ever
// touched, and that RPC only returns rows created by a human approval, so
// nothing unapproved can be uploaded from here.

import crypto from 'node:crypto';
import sharp from 'sharp';
import { assertLacosteImageUrl } from './scoring.mjs';

export const BUCKET = 'produto-imagens-publicadas';
export const MAX_EDGE_PX = 1200;
export const WEBP_QUALITY = 82;
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const CACHE_CONTROL_SECONDS = '31536000'; // paths are immutable, so cache forever

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const bound = (msg) => String(msg ?? 'erro desconhecido').slice(0, 500);

// Review-to-publication integrity. The reviewer approves an exact CDN URL;
// Salesforce Commerce Cloud embeds a content-version token ("/dw<hex>/") in
// that URL, which changes whenever the asset is replaced. Requiring it means
// the bytes published are the asset version the reviewer saw, without
// storing unapproved previews anywhere. The file name must also carry the
// approved colour code, as every Lacoste gallery file observed does.
export function assertPublishableSource(url, corCodigo) {
  const u = assertLacosteImageUrl(url);
  if (!/\/dw[0-9a-f]{6,}\//.test(u.pathname)) {
    throw new Error('URL de origem sem token de versão (/dw…/): integridade não garantida');
  }
  const file = u.pathname.split('/').pop() ?? '';
  if (!file.includes(`_${corCodigo}_`)) {
    throw new Error(`nome do arquivo de origem não contém a cor aprovada (_${corCodigo}_)`);
  }
  return u;
}

// The storage path is assigned by the database at approval time; the worker
// only re-checks it and never invents one.
export function assertStoragePath(pub, arquivo) {
  const expected = `${pub.produto}/${pub.cor_codigo}/${pub.publicacao_id}/${arquivo.slot}.webp`;
  if (arquivo.storage_path !== expected
      || !/^[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/[0-9a-f-]{36}\/(principal|secundaria)\.webp$/.test(arquivo.storage_path)) {
    throw new Error(`caminho de armazenamento inesperado: ${arquivo.storage_path}`);
  }
}

// Deterministic for a given input and sharp version, which is what makes a
// crash-retry find an identical object already in the bucket.
export async function toWebp(source) {
  const { data, info } = await sharp(source, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  if (data.length > MAX_OUTPUT_BYTES) throw new Error('WebP gerado excede 2 MB');
  return { data, width: info.width, height: info.height };
}

const isAlreadyExists = (error) =>
  String(error?.statusCode ?? error?.status ?? '') === '409' || /already exists|duplicate/i.test(error?.message ?? '');

// Upload without overwrite. If the object already exists (e.g. a crash after
// upload but before the database recorded it), accept it only when its
// content is byte-identical; otherwise refuse and leave it untouched.
export async function uploadImmutable(storage, path, data, contentSha) {
  const up = await storage.upload(path, data, {
    contentType: 'image/webp',
    upsert: false,
    cacheControl: CACHE_CONTROL_SECONDS,
  });
  if (!up.error) return 'enviado';
  if (!isAlreadyExists(up.error)) throw new Error(`upload falhou: ${up.error.message}`);

  const dl = await storage.download(path);
  if (dl.error) throw new Error(`objeto já existe e não pôde ser verificado: ${dl.error.message}`);
  const existing = Buffer.from(await dl.data.arrayBuffer());
  if (sha256(existing) !== contentSha) {
    throw new Error('objeto já existe com conteúdo diferente; não sobrescrito');
  }
  return 'já existia (idêntico)';
}

async function call(rpc, name, params) {
  const { error } = await rpc(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
}

// Publishes one approved image set. Files already recorded by the database
// are skipped, so a retry after a partial failure resumes where it stopped.
// Activation happens only once every file is recorded, in one transaction.
export async function publishPublication(pub, { fetchSource, storage, rpc }) {
  const report = { publicacao_id: pub.publicacao_id, produto: pub.produto, cor_codigo: pub.cor_codigo, arquivos: [] };
  try {
    const arquivos = Array.isArray(pub.arquivos) ? pub.arquivos : [];
    if (!arquivos.some((a) => a.slot === 'principal')) throw new Error('publicação sem arquivo principal');

    for (const a of arquivos) {
      assertStoragePath(pub, a);
      if (a.content_sha256) {
        report.arquivos.push({ slot: a.slot, resultado: 'já registrado' });
        continue;
      }
      assertPublishableSource(a.source_url, pub.cor_codigo);
      const source = await fetchSource(a.source_url);
      const sourceSha = sha256(source);
      const out = await toWebp(source);
      const contentSha = sha256(out.data);
      const resultado = await uploadImmutable(storage, a.storage_path, out.data, contentSha);
      await call(rpc, 'registrar_envio_arquivo_publicacao', {
        p_arquivo_id: a.arquivo_id,
        p_source_sha256: sourceSha,
        p_content_sha256: contentSha,
        p_bytes: out.data.length,
        p_width: out.width,
        p_height: out.height,
      });
      report.arquivos.push({ slot: a.slot, resultado, bytes: out.data.length, width: out.width, height: out.height });
    }

    await call(rpc, 'ativar_publicacao_imagem', { p_publicacao_id: pub.publicacao_id });
    report.status = 'ativada';
  } catch (err) {
    report.status = 'falha';
    report.erro = bound(err?.message);
    try {
      await call(rpc, 'registrar_falha_publicacao_imagem', { p_publicacao_id: pub.publicacao_id, p_erro: report.erro });
    } catch (logErr) {
      report.erro_ao_registrar_falha = bound(logErr?.message);
    }
  }
  return report;
}

// Dry-run plan: validates what can be validated without the browser or
// storage, and performs no writes.
export function planPublication(pub) {
  const arquivos = (Array.isArray(pub.arquivos) ? pub.arquivos : []).map((a) => {
    const problemas = [];
    try { assertStoragePath(pub, a); } catch (e) { problemas.push(e.message); }
    try { assertPublishableSource(a.source_url, pub.cor_codigo); } catch (e) { problemas.push(e.message); }
    return { slot: a.slot, source_url: a.source_url, storage_path: a.storage_path, ja_registrado: Boolean(a.content_sha256), problemas };
  });
  return { publicacao_id: pub.publicacao_id, produto: pub.produto, cor_codigo: pub.cor_codigo, tentativas: pub.tentativas, arquivos };
}
