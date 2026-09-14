// Pure mirror of escala_processar_importacao's own zero-diff revision guard
// (supabase/migrations/20260914_009_block_zero_diff_revision_publish.sql).
// The RPC is still the authoritative enforcement — it refuses to write even
// if publicar=true is forced, regardless of what the client does. This
// function exists so the Admin UI can hide "Publicar escala" before ever
// attempting the call, and so this small decision has direct unit test
// coverage without needing a live database.
export interface EscalaImportacaoEstadoInput {
  is_revisao: boolean | null;
  diff: readonly unknown[];
}

export function possuiAlteracoesParaPublicar(resultado: EscalaImportacaoEstadoInput): boolean {
  if (!resultado.is_revisao) return true;
  return resultado.diff.length > 0;
}
