import {
  LIMPEZA_ATRIBUICAO_CONCLUIDA_MESSAGE,
  LIMPEZA_ATRIBUICAO_EM_CONFLITO_MESSAGE,
  LIMPEZA_ATRIBUICAO_NAO_ENCONTRADA_MESSAGE,
  LIMPEZA_ATRIBUICAO_SEM_FUNCIONARIO_MESSAGE,
  LIMPEZA_CONCLUIR_ERRO_GENERICO_MESSAGE,
  LIMPEZA_CONFLITO_MESMA_PESSOA_MESSAGE,
  LIMPEZA_FUNCIONARIO_INDISPONIVEL_MESSAGE,
  LIMPEZA_MANUAL_ERRO_GENERICO_MESSAGE,
  LIMPEZA_SEM_PERMISSAO_CONCLUIR_MESSAGE,
  LIMPEZA_SEM_PERMISSAO_LIMPEZA_MESSAGE,
  LOCALE_PT_BR,
  MANAUS_TIMEZONE,
} from "@/config/constants";
import type { LimpezaTarefa, LimpezaTurno } from "@/integrations/supabase/contracts";

/**
 * Limpeza V1 — pure helpers. All generation/fairness/sync logic lives in SQL
 * (supabase/migrations/20260925_102_add_limpeza_rpcs.sql); this module only
 * formats data already returned by the RPCs and maps their error codes.
 */

// Display order within a day: manhã before tarde, varrer before passar pano
// — matches the order limpeza_sincronizar_dia resolves assignments in.
export const LIMPEZA_TURNO_ORDEM: readonly LimpezaTurno[] = ["manha", "tarde"];
export const LIMPEZA_TAREFA_ORDEM: readonly LimpezaTarefa[] = ["varrer", "passar_pano"];

/** "10:18" — Manaus local time, for the "Concluído às ..." label. */
export function formatLimpezaHora(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

const CONCLUIR_ERROR_MESSAGES: Record<string, string> = {
  INVALID_SESSION: LIMPEZA_CONCLUIR_ERRO_GENERICO_MESSAGE,
  ATRIBUICAO_NAO_ENCONTRADA: LIMPEZA_ATRIBUICAO_NAO_ENCONTRADA_MESSAGE,
  SEM_PERMISSAO_CONCLUIR_LIMPEZA: LIMPEZA_SEM_PERMISSAO_CONCLUIR_MESSAGE,
  ATRIBUICAO_SEM_FUNCIONARIO: LIMPEZA_ATRIBUICAO_SEM_FUNCIONARIO_MESSAGE,
  ATRIBUICAO_EM_CONFLITO: LIMPEZA_ATRIBUICAO_EM_CONFLITO_MESSAGE,
};

export function getLimpezaConcluirErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return LIMPEZA_CONCLUIR_ERRO_GENERICO_MESSAGE;
  return CONCLUIR_ERROR_MESSAGES[message] ?? LIMPEZA_CONCLUIR_ERRO_GENERICO_MESSAGE;
}

const MANUAL_ERROR_MESSAGES: Record<string, string> = {
  SEM_PERMISSAO_LIMPEZA: LIMPEZA_SEM_PERMISSAO_LIMPEZA_MESSAGE,
  TURNO_INVALIDO: LIMPEZA_MANUAL_ERRO_GENERICO_MESSAGE,
  TAREFA_INVALIDA: LIMPEZA_MANUAL_ERRO_GENERICO_MESSAGE,
  FUNCIONARIO_INDISPONIVEL: LIMPEZA_FUNCIONARIO_INDISPONIVEL_MESSAGE,
  CONFLITO_MESMA_PESSOA: LIMPEZA_CONFLITO_MESMA_PESSOA_MESSAGE,
  ATRIBUICAO_CONCLUIDA: LIMPEZA_ATRIBUICAO_CONCLUIDA_MESSAGE,
};

export function getLimpezaManualErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return LIMPEZA_MANUAL_ERRO_GENERICO_MESSAGE;
  return MANUAL_ERROR_MESSAGES[message] ?? LIMPEZA_MANUAL_ERRO_GENERICO_MESSAGE;
}
