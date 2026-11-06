// Stock-prioritized image batch (Trello #10 follow-up).
//
//   npm run lote                    dry-run: show the selection, touch nothing
//   npm run lote -- --persist       acquire + score into the review queue
//   npm run lote -- --limit=10 --persist
//
// Selection comes from the service_role RPC listar_cores_estoque_sem_imagem
// (colours with stock and no image work yet, highest stock first). Execution
// reuses the existing workers unchanged: acquire.mjs, then score.mjs --persist,
// 5 combinations at a time. Nothing is approved, rejected or published here.
//
// Resumable: a re-run recomputes the selection (combinations that already have
// a candidate are excluded by the RPC) and first scores candidates that were
// acquired but not yet scored, so an interruption loses at most one chunk and
// never duplicates a candidate or pays twice for scoring.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

import { createWorkerClient } from "./supabase-client.mjs";
import { acquireRunLock } from "./runlock.mjs";
import {
  CHUNK_SIZE,
  DEFAULT_MAX_STOCK_AGE_HOURS,
  addSkip,
  avaliarFrescor,
  chunk,
  defaultSkipFile,
  escolherLote,
  loadSkip,
  parseLoteArgs,
  toProdutosArg,
} from "./lote-selecao.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", ".env") });

const stamp = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const CHUNK_TIMEOUT_MS = 25 * 60_000;

let currentChild = null;
let interrupted = false;

function runWorker(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, script), ...args], {
      cwd: path.join(here, ".."),
      stdio: ["ignore", "inherit", "inherit"],
    });
    currentChild = child;
    const timer = setTimeout(() => {
      stamp(`${script}: tempo limite do bloco; encerrando`);
      child.kill();
    }, CHUNK_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      currentChild = null;
      resolve(code ?? 1);
    });
    child.on("error", () => {
      clearTimeout(timer);
      currentChild = null;
      resolve(1);
    });
  });
}

async function candidatosPendentes(supabase, items) {
  const found = new Map();
  for (const { produto, cor_codigo } of items) {
    const { data, error } = await supabase
      .from("produto_imagem_candidatos")
      .select("produto,cor_codigo,scoring_notes")
      .eq("produto", produto)
      .eq("cor_codigo", cor_codigo)
      .eq("status", "pendente")
      .maybeSingle();
    if (error) throw new Error(`select candidatos: ${error.message}`);
    if (data) found.set(`${produto}:${cor_codigo}`, data);
  }
  return found;
}

async function selecionar(supabase, limit) {
  const { data, error } = await supabase.rpc("listar_cores_estoque_sem_imagem", {
    // Over-fetch so recently-not-found combinations can be skipped.
    p_limite: Math.min(200, limit * 3),
  });
  if (error) throw new Error(`listar_cores_estoque_sem_imagem: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return { rows, chosen: [], skipped: 0, syncConcluidoEm: null };

  const maxHoras = Number(process.env.LOTE_MAX_IDADE_ESTOQUE_HORAS) || DEFAULT_MAX_STOCK_AGE_HOURS;
  const syncConcluidoEm = rows[0].sync_concluido_em;
  const frescor = avaliarFrescor(syncConcluidoEm, { maxHoras });
  if (!frescor.fresh) {
    throw new Error(
      `snapshot de estoque desatualizado: concluído em ${syncConcluidoEm} ` +
        `(${frescor.ageHours.toFixed(1)} h; máximo ${maxHoras} h). Rode o sync de estoque antes.`,
    );
  }
  const { chosen, skipped } = escolherLote(rows, loadSkip(defaultSkipFile()), { limit });
  return { rows, chosen, skipped, syncConcluidoEm };
}

async function main() {
  const { persist, limit } = parseLoteArgs(process.argv.slice(2));
  const supabase = createWorkerClient();
  stamp(`Lote de imagens: modo=${persist ? "PERSIST" : "dry-run"} limit=${limit}`);

  const lock = persist
    ? acquireRunLock(
        process.env.LOTE_LOCK_FILE ||
          path.join(process.env.TEMP || "/tmp", "portal-benvisi-lote.lock"),
      )
    : null;
  if (lock && !lock.acquired) {
    stamp(
      `outra execução em andamento (pid ${lock.holder.pid}); nada a fazer (lock: ${lock.file})`,
    );
    return;
  }
  const onSignal = () => {
    interrupted = true;
    stamp("interrompido; finalizando o bloco atual");
    currentChild?.kill();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    // Resume: candidates acquired earlier but never scored.
    const { data: semNota, error: semNotaErr } = await supabase
      .from("produto_imagem_candidatos")
      .select("produto,cor_codigo")
      .eq("status", "pendente")
      .is("scoring_notes", null)
      .order("criado_em")
      .limit(limit);
    if (semNotaErr) throw new Error(`select sem pontuação: ${semNotaErr.message}`);

    const { chosen, skipped, syncConcluidoEm } = await selecionar(supabase, limit);
    stamp(
      `estoque concluído em ${syncConcluidoEm ?? "—"}; ${chosen.length} combinação(ões) ` +
        `selecionada(s); ${skipped} ignorada(s) (não encontradas recentemente); ` +
        `${semNota.length} candidato(s) aguardando pontuação`,
    );
    for (const c of chosen) {
      stamp(`  ${c.produto}:${c.cor_codigo}  estoque=${c.estoque_total}`);
    }
    if (!persist) {
      stamp("dry-run: nenhuma aquisição, pontuação ou gravação foi feita.");
      return;
    }

    const resumo = { adquiridos: 0, pontuados: 0, naoEncontrados: 0 };

    // 1. Score what was left unscored by an interrupted run.
    for (const bloco of chunk(semNota)) {
      if (interrupted) break;
      stamp(`pontuando ${bloco.length} candidato(s) pendente(s) anteriores`);
      await runWorker("score.mjs", [`--produtos=${toProdutosArg(bloco)}`, "--persist"]);
      resumo.pontuados += bloco.length;
    }

    // 2. Acquire, then score, 5 at a time.
    for (const bloco of chunk(chosen)) {
      if (interrupted) break;
      const lista = toProdutosArg(bloco);
      stamp(`adquirindo: ${lista}`);
      const code = await runWorker("acquire.mjs", [`--produtos=${lista}`, `--limit=${CHUNK_SIZE}`]);
      const achados = await candidatosPendentes(supabase, bloco);
      const faltando = bloco.filter((b) => !achados.has(`${b.produto}:${b.cor_codigo}`));
      resumo.adquiridos += achados.size;
      if (code === 0 && faltando.length > 0) {
        resumo.naoEncontrados += faltando.length;
        addSkip(defaultSkipFile(), faltando);
        stamp(
          `sem candidato (não encontrado/verificação falhou), ignorado por 3 dias: ` +
            faltando.map((f) => `${f.produto}:${f.cor_codigo}`).join(", "),
        );
      }
      if (achados.size > 0 && !interrupted) {
        stamp(`pontuando ${achados.size} candidato(s)`);
        await runWorker("score.mjs", [
          `--produtos=${toProdutosArg([...achados.values()])}`,
          "--persist",
        ]);
        const depois = await candidatosPendentes(supabase, bloco);
        resumo.pontuados += [...depois.values()].filter((d) => d.scoring_notes).length;
      }
    }

    stamp(
      `RESUMO: selecionados=${chosen.length} adquiridos=${resumo.adquiridos} ` +
        `pontuados=${resumo.pontuados} não-encontrados=${resumo.naoEncontrados}` +
        `${interrupted ? " (interrompido)" : ""}`,
    );
    if (interrupted) process.exitCode = 130;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    lock?.release();
  }
}

if (process.argv[1]?.endsWith("lote.mjs"))
  main().catch((e) => {
    console.error(`${new Date().toISOString()} ERRO: ${e.message}`);
    process.exit(1);
  });
