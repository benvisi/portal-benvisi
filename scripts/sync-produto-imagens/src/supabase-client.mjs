// Supabase writes for the acquisition worker (Trello #10, Slice 2).
// service_role access only — produto_imagem_execucoes/candidatos have RLS
// enabled with zero browser-facing policies (Slice 1 migration), so this is
// the only key that can write to them. Never imported by src/ (Portal UI).

import { createClient } from "@supabase/supabase-js";

export function createWorkerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function createExecucao(supabase, modo = "aquisicao") {
  const { data, error } = await supabase
    .from("produto_imagem_execucoes")
    .insert({ modo, status: "executando" })
    .select("id")
    .single();
  if (error) throw new Error(`createExecucao failed: ${error.message}`);
  return data.id;
}

export async function completeExecucao(
  supabase,
  execucaoId,
  { status, produtosProcessados, candidatosNovos, erro },
) {
  const { error } = await supabase
    .from("produto_imagem_execucoes")
    .update({
      status,
      concluido_em: new Date().toISOString(),
      produtos_processados: produtosProcessados,
      candidatos_novos: candidatosNovos,
      erro: erro ?? null,
    })
    .eq("id", execucaoId);
  if (error) throw new Error(`completeExecucao failed: ${error.message}`);
}

// Respects the production partial unique index
// (produto_imagem_candidatos_pendente_uidx on (produto, cor_codigo) WHERE
// status = 'pendente'): checks for an existing pending row first so a
// rerun of the same exact combination is a reported no-op, not a crash.
// Approved/rejected history rows are never touched or deleted.
export async function findPendingCandidate(supabase, produto, corCodigo) {
  const { data, error } = await supabase
    .from("produto_imagem_candidatos")
    .select("id, criado_em")
    .eq("produto", produto)
    .eq("cor_codigo", corCodigo)
    .eq("status", "pendente")
    .maybeSingle();
  if (error) throw new Error(`findPendingCandidate failed: ${error.message}`);
  return data;
}

export async function insertCandidate(supabase, { execucaoId, produto, corCodigo, candidate }) {
  const row = {
    execucao_id: execucaoId,
    produto,
    cor_codigo: corCodigo,
    status: "pendente",
    lacoste_pid: candidate.lacoste_pid,
    lacoste_color_id: candidate.lacoste_color_id,
    lacoste_color_label: candidate.lacoste_color_label,
    lacoste_product_name: candidate.lacoste_product_name,
    resolved_url: candidate.resolved_url,
    verification_ok: candidate.verification_ok,
    gallery_json: candidate.gallery_json,
    limitacoes: [],
  };

  const { data, error } = await supabase
    .from("produto_imagem_candidatos")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation. A concurrent run could race past the
    // findPendingCandidate check above; treat that race the same as the
    // pre-check hit rather than crashing the worker.
    if (error.code === "23505") {
      return { alreadyPending: true };
    }
    throw new Error(`insertCandidate failed: ${error.message}`);
  }
  return { id: data.id };
}

// Persists advisory scoring via the narrow SECURITY DEFINER RPC (Slice 4A);
// service_role has no table-level UPDATE on candidates by design.
export async function registrarPontuacao(supabase, params) {
  const { error } = await supabase.rpc("registrar_pontuacao_candidato", params);
  if (error) throw new Error(`registrar_pontuacao_candidato failed: ${error.message}`);
}
