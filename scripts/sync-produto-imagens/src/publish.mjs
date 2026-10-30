// Publishing worker CLI (Trello #10, Slice 4B).
//
//   npm run publicar                dry-run (default): lists approved,
//                                   not-yet-published sets and validates them;
//                                   no browser, no uploads, no writes.
//   npm run publicar -- --persist   downloads each approved image through the
//                                   headed browser session, converts it to
//                                   WebP and uploads it to the public bucket,
//                                   then activates the set atomically.
//   --limit=N                       1–20, default 5.
//
// Nothing here approves anything: the queue only contains sets a human
// approved through aprovar_candidato_imagem.

import 'dotenv/config';
import { parseFlags } from './args.mjs';
import { createWorkerClient, createExecucao, completeExecucao } from './supabase-client.mjs';
import { launchSession, closeSession, fetchImageBytes } from './lacoste.mjs';
import { BUCKET, publishPublication, planPublication } from './publishing.mjs';

export function parsePublishArgs(argv) {
  const flags = parseFlags(argv);
  const persist = flags.persist === true || flags.persist === 'true';
  const dryRun = flags['dry-run'] === true || flags['dry-run'] === 'true';
  if (persist && dryRun) throw new Error('--dry-run and --persist are mutually exclusive');
  let limit = 5;
  if (flags.limit !== undefined) {
    limit = Number.parseInt(flags.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new Error(`--limit must be an integer between 1 and 20, got "${flags.limit}"`);
    }
  }
  return { persist, limit };
}

async function main() {
  const { persist, limit } = parsePublishArgs(process.argv.slice(2));
  console.log(persist ? 'MODE: PERSIST (uploads + activation)' : 'MODE: dry-run (no browser, no uploads, no writes)');

  const supabase = createWorkerClient();
  const { data: fila, error } = await supabase.rpc('listar_publicacoes_imagem_pendentes', { p_limite: limit });
  if (error) throw new Error(`listar_publicacoes_imagem_pendentes: ${error.message}`);
  console.log(`${fila.length} publicação(ões) pendente(s) (limit=${limit})`);

  if (!persist) {
    for (const pub of fila) console.log(JSON.stringify(planPublication(pub), null, 2));
    return;
  }
  if (fila.length === 0) return;

  // The read path builds public URLs, so a missing or private bucket is a
  // configuration error, not something to work around here.
  const { data: bucket, error: bucketErr } = await supabase.storage.getBucket(BUCKET);
  if (bucketErr || !bucket) throw new Error(`bucket ${BUCKET} indisponível: ${bucketErr?.message ?? 'não encontrado'}`);
  if (bucket.public !== true) throw new Error(`bucket ${BUCKET} não é público`);

  const execucaoId = await createExecucao(supabase, 'publicacao');
  const storageBucket = supabase.storage.from(BUCKET);
  const deps = {
    storage: {
      upload: (path, data, opts) => storageBucket.upload(path, data, opts),
      download: (path) => storageBucket.download(path),
    },
    rpc: (name, params) => supabase.rpc(name, params),
  };

  let session;
  const reports = [];
  let fatal = null;
  try {
    session = await launchSession();
    deps.fetchSource = (url) => fetchImageBytes(session, url);
    for (const pub of fila) {
      const report = await publishPublication(pub, deps);
      reports.push(report);
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (err) {
    fatal = err;
  } finally {
    await closeSession(session);
  }

  const ativadas = reports.filter((r) => r.status === 'ativada').length;
  await completeExecucao(supabase, execucaoId, {
    status: fatal ? 'erro' : 'sucesso',
    produtosProcessados: reports.length,
    candidatosNovos: 0,
    erro: fatal ? String(fatal.message).slice(0, 500) : null,
  });

  if (fatal) {
    console.error('FATAL (run-level):', fatal.message);
    process.exitCode = 1;
  } else {
    console.log(`\nRun complete. ${ativadas} of ${reports.length} publication(s) activated.`);
  }
}

if (process.argv[1]?.endsWith('publish.mjs')) {
  main().catch((err) => {
    console.error('Unhandled error:', err.message);
    process.exitCode = 1;
  });
}
