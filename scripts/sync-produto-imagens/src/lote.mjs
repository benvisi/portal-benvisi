// Stock-prioritized image batch (Trello #10 follow-up).
//
//   npm run lote                              dry-run: show the next round, touch nothing
//   npm run lote -- --persist --limit=250     acquire + score until 250 candidates are ready
//   npm run lote -- --persist --limit=10      small sample
//
// --limit is the TARGET of successfully scored, reviewable candidates for this run
// (not attempts). Work is done in rounds of --round combinations (default 25):
// each round re-reads the stock selection from the service_role RPC
// listar_cores_estoque_sem_imagem (colours with stock and no image work yet,
// highest stock first, diversified across products), then acquire.mjs and
// score.mjs run unchanged, 5 combinations at a time. Nothing is approved,
// rejected or published here.
//
// Progress is guaranteed: a combination that produced a candidate is excluded by
// the RPC from then on; one that did not is added to the 3-day local skip list
// (Lacoste miss) and to an in-memory "tried in this run" set (crashes), so it can
// never be selected twice in one run. Resumable: a re-run first scores candidates
// that were acquired but not scored, then continues the selection.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

import { createWorkerClient } from "./supabase-client.mjs";
import { acquireRunLock } from "./runlock.mjs";
import {
  CHUNK_SIZE,
  DEFAULT_MAX_STOCK_AGE_HOURS,
  MAX_EMPTY_CHUNKS,
  addSkip,
  avaliarFrescor,
  chunk,
  defaultSkipFile,
  escolherLote,
  keyOf,
  loadSkip,
  parseLoteArgs,
  toProdutosArg,
} from "./lote-selecao.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", ".env") });

const stamp = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const CHUNK_TIMEOUT_MS = 25 * 60_000;
const RPC_MAX_ROWS = 200;

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
    if (data) found.set(keyOf(produto, cor_codigo), data);
  }
  return found;
}

const contarProntos = (found) => [...found.values()].filter((d) => d.scoring_notes).length;

async function totalAguardandoRevisao(supabase) {
  const { count, error } = await supabase
    .from("produto_imagem_candidatos")
    .select("produto", { count: "exact", head: true })
    .eq("status", "pendente")
    .not("scoring_notes", "is", null);
  if (error) throw new Error(`count candidatos: ${error.message}`);
  return count;
}

async function selecionar(supabase, want, round, exclude) {
  const { data, error } = await supabase.rpc("listar_cores_estoque_sem_imagem", {
    p_limite: RPC_MAX_ROWS,
  });
  if (error) throw new Error(`listar_cores_estoque_sem_imagem: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0)
    return { chosen: [], skipped: 0, eligible: 0, products: 0, syncConcluidoEm: null };

  const maxHoras = Number(process.env.LOTE_MAX_IDADE_ESTOQUE_HORAS) || DEFAULT_MAX_STOCK_AGE_HOURS;
  const syncConcluidoEm = rows[0].sync_concluido_em;
  const frescor = avaliarFrescor(syncConcluidoEm, { maxHoras });
  if (!frescor.fresh) {
    throw new Error(
      `snapshot de estoque desatualizado: concluído em ${syncConcluidoEm} ` +
        `(${frescor.ageHours.toFixed(1)} h; máximo ${maxHoras} h). Rode o sync de estoque antes.`,
    );
  }
  const { chosen, skipped, eligible } = escolherLote(rows, loadSkip(defaultSkipFile()), {
    limit: Math.min(want, round),
    exclude,
  });
  const products = new Set(chosen.map((c) => c.produto)).size;
  return { chosen, skipped, eligible, products, syncConcluidoEm };
}

async function main() {
  const { persist, limit, round } = parseLoteArgs(process.argv.slice(2));
  const supabase = createWorkerClient();
  stamp(`Lote de imagens: modo=${persist ? "PERSIST" : "dry-run"} meta=${limit} rodada=${round}`);

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

  const resumo = { prontos: 0, adquiridos: 0, naoEncontrados: 0, semPontuacao: 0, rodadas: 0 };
  const tentados = new Set();
  let vazios = 0;
  let motivo = "meta atingida";

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
    stamp(`${semNota.length} candidato(s) adquiridos antes e ainda sem pontuação`);

    if (persist) {
      for (const bloco of chunk(semNota)) {
        if (interrupted || resumo.prontos >= limit) break;
        stamp(`pontuando ${bloco.length} candidato(s) pendente(s) anteriores`);
        await runWorker("score.mjs", [`--produtos=${toProdutosArg(bloco)}`, "--persist"]);
        const depois = await candidatosPendentes(supabase, bloco);
        const prontos = contarProntos(depois);
        resumo.prontos += prontos;
        resumo.semPontuacao += bloco.length - prontos;
      }
    }

    while (resumo.prontos < limit && !interrupted) {
      const falta = limit - resumo.prontos;
      const sel = await selecionar(supabase, falta, round, tentados);
      resumo.rodadas += 1;
      stamp(
        `rodada ${resumo.rodadas}: estoque concluído em ${sel.syncConcluidoEm ?? "—"}; ` +
          `${sel.chosen.length} selecionada(s) de ${sel.eligible} elegíveis visíveis ` +
          `(${sel.products} produto(s)); ${sel.skipped} ignorada(s); ` +
          `prontos ${resumo.prontos}/${limit}`,
      );
      for (const c of sel.chosen) {
        stamp(`  ${c.produto}:${c.cor_codigo}  estoque=${c.estoque_total}`);
      }
      if (!persist) {
        stamp("dry-run: nenhuma aquisição, pontuação ou gravação foi feita.");
        return;
      }
      if (sel.chosen.length === 0) {
        motivo = "sem mais combinações elegíveis";
        break;
      }

      for (const bloco of chunk(sel.chosen)) {
        if (interrupted) break;
        for (const b of bloco) tentados.add(keyOf(b.produto, b.cor_codigo));
        const lista = toProdutosArg(bloco);
        stamp(`adquirindo: ${lista}`);
        const code = await runWorker("acquire.mjs", [
          `--produtos=${lista}`,
          `--limit=${CHUNK_SIZE}`,
        ]);
        const achados = await candidatosPendentes(supabase, bloco);
        const faltando = bloco.filter((b) => !achados.has(keyOf(b.produto, b.cor_codigo)));
        resumo.adquiridos += achados.size;
        if (code === 0 && faltando.length > 0) {
          resumo.naoEncontrados += faltando.length;
          addSkip(defaultSkipFile(), faltando);
          stamp(
            `sem candidato (não encontrado/verificação falhou), ignorado por 3 dias: ` +
              faltando.map((f) => `${f.produto}:${f.cor_codigo}`).join(", "),
          );
        }
        if (achados.size === 0) {
          vazios += 1;
          if (vazios >= MAX_EMPTY_CHUNKS) {
            motivo = `${MAX_EMPTY_CHUNKS} blocos seguidos sem nenhum candidato (bloqueio do site?)`;
            interrupted = true;
            process.exitCode = 1;
            break;
          }
          continue;
        }
        vazios = 0;
        if (interrupted) break;
        stamp(`pontuando ${achados.size} candidato(s)`);
        await runWorker("score.mjs", [
          `--produtos=${toProdutosArg([...achados.values()])}`,
          "--persist",
        ]);
        const prontos = contarProntos(await candidatosPendentes(supabase, bloco));
        resumo.prontos += prontos;
        resumo.semPontuacao += achados.size - prontos;
        stamp(`progresso: prontos ${resumo.prontos}/${limit}`);
      }
    }

    if (interrupted && motivo === "meta atingida") motivo = "interrompido";
    const aguardando = persist ? await totalAguardandoRevisao(supabase) : "—";
    stamp(
      `RESUMO: motivo="${motivo}" prontos=${resumo.prontos}/${limit} adquiridos=${resumo.adquiridos} ` +
        `sem-pontuação=${resumo.semPontuacao} não-encontrados=${resumo.naoEncontrados} ` +
        `rodadas=${resumo.rodadas} aguardando-revisão-total=${aguardando}`,
    );
    if (interrupted && !process.exitCode) process.exitCode = 130;
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
