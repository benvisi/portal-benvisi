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
// Scheduled runs (persist mode only; dry-run stays lock-free and read-only):
//   * single instance per machine (lock file, PUBLICAR_LOCK_FILE);
//   * whole-run limit PUBLICAR_MAX_RUNTIME_MIN (default 20) and per-item limit
//     PUBLICAR_ITEM_TIMEOUT_SEC (default 180);
//   * exit codes: 0 ok / nothing to do / another run active, 1 run-level error,
//     2 at least one publication failed (recorded; retried with backoff),
//     124 run limit hit, 130 interrupted.
//
// Nothing here approves anything: the queue only contains sets a human
// approved through aprovar_candidato_imagem.

import "dotenv/config";
import { parseFlags } from "./args.mjs";
import { createWorkerClient, createExecucao, completeExecucao } from "./supabase-client.mjs";
import { launchSession, closeSession, fetchImageBytes } from "./lacoste.mjs";
import { BUCKET, publishPublication, planPublication } from "./publishing.mjs";
import { acquireRunLock } from "./runlock.mjs";
import { readRuntimeConfig, startRunDeadline, TimeoutError, withTimeout } from "./runtime.mjs";

const stamp = (msg) => `${new Date().toISOString()} ${msg}`;

export function parsePublishArgs(argv) {
  const flags = parseFlags(argv);
  const persist = flags.persist === true || flags.persist === "true";
  const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true";
  if (persist && dryRun) throw new Error("--dry-run and --persist are mutually exclusive");
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
  console.log(
    persist
      ? "MODE: PERSIST (uploads + activation)"
      : "MODE: dry-run (no browser, no uploads, no writes)",
  );

  const config = readRuntimeConfig();
  const supabase = createWorkerClient();

  if (!persist) {
    const fila = await listarFila(supabase, limit);
    for (const pub of fila) console.log(JSON.stringify(planPublication(pub), null, 2));
    return;
  }

  const lock = acquireRunLock(config.lockFile, { staleMs: config.lockStaleMs });
  if (!lock.acquired) {
    console.log(stamp(`outra execução em andamento (pid ${lock.holder?.pid}); nada a fazer`));
    return;
  }

  let session;
  let timedOut = false;
  const cleanup = async () => {
    await closeSession(session);
    lock.release();
  };
  const onSignal = (signal, code) => async () => {
    console.error(stamp(`${signal} recebido; encerrando`));
    await cleanup();
    process.exit(code);
  };
  const signals = { SIGINT: 130, SIGTERM: 143, SIGBREAK: 130 };
  for (const [name, code] of Object.entries(signals)) process.on(name, onSignal(name, code));
  const stopDeadline = startRunDeadline({
    maxMs: config.maxRuntimeMs,
    onSoft: async () => {
      timedOut = true;
      console.error(stamp("tempo máximo de execução atingido; fechando o navegador"));
      await closeSession(session);
    },
    onHard: () => {
      console.error(stamp("o encerramento limpo não terminou; saindo à força"));
      lock.release();
      process.exit(124);
    },
  });

  try {
    await runPersist({ supabase, limit, config, setSession: (s) => (session = s) });
    if (timedOut) process.exitCode = 124;
  } finally {
    stopDeadline();
    await cleanup();
  }
}

async function listarFila(supabase, limit) {
  const { data: fila, error } = await supabase.rpc("listar_publicacoes_imagem_pendentes", {
    p_limite: limit,
  });
  if (error) throw new Error(`listar_publicacoes_imagem_pendentes: ${error.message}`);
  console.log(`${fila.length} publicação(ões) pendente(s) (limit=${limit})`);
  return fila;
}

async function runPersist({ supabase, limit, config, setSession }) {
  const fila = await listarFila(supabase, limit);
  if (fila.length === 0) return;

  // The read path builds public URLs, so a missing or private bucket is a
  // configuration error, not something to work around here.
  const { data: bucket, error: bucketErr } = await supabase.storage.getBucket(BUCKET);
  if (bucketErr || !bucket)
    throw new Error(`bucket ${BUCKET} indisponível: ${bucketErr?.message ?? "não encontrado"}`);
  if (bucket.public !== true) throw new Error(`bucket ${BUCKET} não é público`);

  const execucaoId = await createExecucao(supabase, "publicacao");
  const storageBucket = supabase.storage.from(BUCKET);
  // After an item times out its promise may still settle later; its own
  // failure record is suppressed so the attempt is counted exactly once.
  let abandoned = false;
  const deps = {
    storage: {
      upload: (path, data, opts) => storageBucket.upload(path, data, opts),
      download: (path) => storageBucket.download(path),
    },
    rpc: (name, params) =>
      abandoned && name === "registrar_falha_publicacao_imagem"
        ? Promise.resolve({ error: null })
        : supabase.rpc(name, params),
  };

  let session;
  const reports = [];
  let fatal = null;
  try {
    session = await launchSession();
    setSession(session);
    deps.fetchSource = (url) => fetchImageBytes(session, url);
    for (const pub of fila) {
      let report;
      try {
        report = await withTimeout(
          publishPublication(pub, deps),
          config.itemTimeoutMs,
          `publicação ${pub.publicacao_id}`,
        );
      } catch (err) {
        if (!(err instanceof TimeoutError)) throw err;
        // A hung item must cost an attempt (otherwise it would block the head
        // of the queue on every run), and the run stops: its work may still
        // be in flight, so nothing else is started on this browser.
        abandoned = true;
        await supabase.rpc("registrar_falha_publicacao_imagem", {
          p_publicacao_id: pub.publicacao_id,
          p_erro: err.message,
        });
        reports.push({ publicacao_id: pub.publicacao_id, status: "falha", erro: err.message });
        throw err;
      }
      reports.push(report);
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (err) {
    fatal = err;
  } finally {
    await closeSession(session);
  }

  const ativadas = reports.filter((r) => r.status === "ativada").length;
  const falhas = reports.filter((r) => r.status === "falha").length;
  await completeExecucao(supabase, execucaoId, {
    status: fatal ? "erro" : "sucesso",
    produtosProcessados: reports.length,
    candidatosNovos: 0,
    erro: fatal ? String(fatal.message).slice(0, 500) : null,
  });

  if (fatal) {
    console.error(stamp(`FATAL (run-level): ${fatal.message}`));
    process.exitCode = 1;
  } else {
    console.log(
      stamp(
        `Run complete. ${ativadas} of ${reports.length} publication(s) activated; ${falhas} failed.`,
      ),
    );
    if (falhas > 0) process.exitCode = 2;
  }
}

if (process.argv[1]?.endsWith("publish.mjs")) {
  main().catch((err) => {
    console.error("Unhandled error:", err.message);
    process.exitCode = 1;
  });
}
