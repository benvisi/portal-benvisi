// Bounded Lacoste product-image acquisition worker (Trello #10, Slice 2).
//
// explicit PRODUTO:COR input -> headed Chrome -> exact storefront variant
// verification -> structured gallery acquisition -> durable
// produto_imagem_candidatos row -> produto_imagem_execucoes audit ledger.
//
// No AI/vision scoring, no Storage, no primary/secondary selection: those
// are later slices. See scripts/sync-produto-imagens/README.md.

import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

import { parseArgs } from "./args.mjs";
import { launchSession, closeSession, verifyAndAcquire, Outcome } from "./lacoste.mjs";
import {
  createWorkerClient,
  createExecucao,
  completeExecucao,
  findPendingCandidate,
  insertCandidate,
} from "./supabase-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MAX_ERROR_TEXT_LENGTH = 2000;

function boundError(err) {
  const text = err?.stack ?? err?.message ?? String(err);
  return text.length > MAX_ERROR_TEXT_LENGTH
    ? `${text.slice(0, MAX_ERROR_TEXT_LENGTH)}…(truncated)`
    : text;
}

async function processItem(session, supabase, execucaoId, { produto, cor }, { dryRun }) {
  const result = await verifyAndAcquire(session, produto, cor);

  if (result.outcome !== Outcome.EXACT_MATCH) {
    return {
      produto,
      cor,
      outcome: result.outcome,
      reason: result.reason,
      requestUrl: result.requestUrl,
    };
  }

  const summary = {
    produto,
    cor,
    outcome: Outcome.EXACT_MATCH,
    productName: result.candidate.lacoste_product_name,
    colorLabel: result.candidate.lacoste_color_label,
    resolvedUrl: result.candidate.resolved_url,
    galleryImageCount: result.galleryImageCount,
    galleryTotalCount: result.galleryTotalCount,
  };

  if (dryRun) {
    return { ...summary, write: "dry-run (no write performed)" };
  }

  const existingPending = await findPendingCandidate(supabase, produto, cor);
  if (existingPending) {
    return {
      ...summary,
      write: `skipped: already-pending candidate exists (id=${existingPending.id}, criado_em=${existingPending.criado_em})`,
    };
  }

  const insertResult = await insertCandidate(supabase, {
    execucaoId,
    produto,
    corCodigo: cor,
    candidate: result.candidate,
  });
  if (insertResult.alreadyPending) {
    return {
      ...summary,
      write: "skipped: already-pending candidate exists (race detected on insert)",
    };
  }
  return { ...summary, write: `inserted new pending candidate (id=${insertResult.id})` };
}

async function main() {
  const { items, dryRun, limit, truncated, requestedCount } = parseArgs();

  console.log(
    `Acquisition run: ${items.length} item(s) (limit=${limit}${truncated ? `, truncated from ${requestedCount} requested` : ""}), dryRun=${dryRun}`,
  );
  for (const { produto, cor } of items) {
    console.log(`  - ${produto}:${cor}`);
  }

  const supabase = dryRun ? null : createWorkerClient();
  let execucaoId = null;
  if (!dryRun) {
    execucaoId = await createExecucao(supabase);
    console.log(`Created produto_imagem_execucoes row: ${execucaoId}`);
  }

  let session;
  const results = [];
  let fatalError = null;

  try {
    session = await launchSession();
    console.log(`Headed browser session established. Origin: ${session.origin}`);

    for (const item of items) {
      try {
        const itemResult = await processItem(session, supabase, execucaoId, item, { dryRun });
        results.push(itemResult);
      } catch (itemErr) {
        // Per-item failures do not crash the run or corrupt prior results —
        // only a run-level failure (browser/session/Supabase-connectivity)
        // below causes the ledger to record status='erro'.
        results.push({
          produto: item.produto,
          cor: item.cor,
          outcome: "ITEM_ERROR",
          reason: boundError(itemErr),
        });
      }
    }
  } catch (err) {
    fatalError = err;
  } finally {
    await closeSession(session);
  }

  console.log("\n=== Results ===");
  for (const r of results) {
    console.log(JSON.stringify(r, null, 2));
  }

  const candidatosNovos = results.filter(
    (r) => typeof r.write === "string" && r.write.startsWith("inserted"),
  ).length;

  if (!dryRun) {
    if (fatalError) {
      await completeExecucao(supabase, execucaoId, {
        status: "erro",
        produtosProcessados: results.length,
        candidatosNovos,
        erro: boundError(fatalError),
      });
    } else {
      await completeExecucao(supabase, execucaoId, {
        status: "sucesso",
        produtosProcessados: results.length,
        candidatosNovos,
      });
    }
  }

  if (fatalError) {
    console.error("\nFATAL (run-level):", boundError(fatalError));
    process.exitCode = 1;
  } else {
    console.log(
      `\nRun complete. ${candidatosNovos} new candidate(s) inserted out of ${results.length} item(s) processed.`,
    );
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exitCode = 1;
});
