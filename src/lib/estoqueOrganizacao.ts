import {
  ESTOQUE_ORGANIZACAO_ATRIBUICAO_NAO_ENCONTRADA_MESSAGE,
  ESTOQUE_ORGANIZACAO_MANUAL_ERRO_GENERICO_MESSAGE,
  ESTOQUE_ORGANIZACAO_PROGRESSO_ERRO_GENERICO_MESSAGE,
  ESTOQUE_ORGANIZACAO_PROGRESSO_INVALIDO_MESSAGE,
  ESTOQUE_ORGANIZACAO_SEM_PERMISSAO_GERENCIAL_MESSAGE,
  ESTOQUE_ORGANIZACAO_SEM_PERMISSAO_PROGRESSO_MESSAGE,
  ESTOQUE_ORGANIZACAO_SEMANA_ENCERRADA_MESSAGE,
  LOCALE_PT_BR,
} from "@/config/constants";
import { addDaysISO } from "@/lib/escala";

/**
 * Estoque - Organização Semanal V1 — pure helpers. All generation/rotation/
 * guard logic lives in SQL (supabase/migrations/20260927_10*_*.sql); this
 * module only computes week boundaries for the UI and maps RPC error codes,
 * mirroring lib/limpeza.ts and lib/escala.ts.
 */

// Sunday that starts the Sunday-Saturday week containing dateISO — the same
// definition as the database's estoque_organizacao_semana_inicio (Postgres
// EXTRACT(DOW ...): Sunday = 0). dateISO is a plain calendar date pinned to
// UTC midnight, matching lib/escala.ts's date model.
export function weekStartISO(dateISO: string): string {
  const dow = new Date(`${dateISO}T00:00:00Z`).getUTCDay();
  return addDaysISO(dateISO, -dow);
}

export function addWeeksISO(dateISO: string, weeks: number): string {
  return addDaysISO(dateISO, weeks * 7);
}

function formatDiaMes(dateISO: string): string {
  return new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${dateISO}T00:00:00Z`));
}

/** "22/09 – 28/09" for the week starting at semanaInicioISO. */
export function formatSemanaLabel(semanaInicioISO: string): string {
  const fimISO = addDaysISO(semanaInicioISO, 6);
  return `${formatDiaMes(semanaInicioISO)} – ${formatDiaMes(fimISO)}`;
}

const PROGRESSO_ERROR_MESSAGES: Record<string, string> = {
  ATRIBUICAO_NAO_ENCONTRADA: ESTOQUE_ORGANIZACAO_ATRIBUICAO_NAO_ENCONTRADA_MESSAGE,
  SEM_PERMISSAO_ESTOQUE_ORGANIZACAO: ESTOQUE_ORGANIZACAO_SEM_PERMISSAO_PROGRESSO_MESSAGE,
  SEMANA_ENCERRADA: ESTOQUE_ORGANIZACAO_SEMANA_ENCERRADA_MESSAGE,
  PROGRESSO_INVALIDO: ESTOQUE_ORGANIZACAO_PROGRESSO_INVALIDO_MESSAGE,
};

export function getEstoqueOrganizacaoProgressoErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return ESTOQUE_ORGANIZACAO_PROGRESSO_ERRO_GENERICO_MESSAGE;
  return PROGRESSO_ERROR_MESSAGES[message] ?? ESTOQUE_ORGANIZACAO_PROGRESSO_ERRO_GENERICO_MESSAGE;
}

const MANUAL_ERROR_MESSAGES: Record<string, string> = {
  SEM_PERMISSAO_ESTOQUE_ORGANIZACAO: ESTOQUE_ORGANIZACAO_SEM_PERMISSAO_GERENCIAL_MESSAGE,
};

export function getEstoqueOrganizacaoManualErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return ESTOQUE_ORGANIZACAO_MANUAL_ERRO_GENERICO_MESSAGE;
  return MANUAL_ERROR_MESSAGES[message] ?? ESTOQUE_ORGANIZACAO_MANUAL_ERRO_GENERICO_MESSAGE;
}
