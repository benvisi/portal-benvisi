import {
  TERMO_BUSCA_MAX_CHARS,
  TERMO_BUSCA_MIN_CHARS,
  TERMOS_BUSCA_ERRO_DESATIVADO_ADMIN_MESSAGE,
  TERMOS_BUSCA_ERRO_DESATIVADO_MESSAGE,
  TERMOS_BUSCA_ERRO_GENERICO_MESSAGE,
  TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE,
  TERMOS_BUSCA_ERRO_JA_APROVADO_MESSAGE,
  TERMOS_BUSCA_ERRO_JA_PENDENTE_MESSAGE,
  TERMOS_BUSCA_ERRO_SEM_PERMISSAO_MESSAGE,
  TERMOS_BUSCA_ERRO_TRANSICAO_MESSAGE,
} from "@/config/constants";

/**
 * Termos de busca V1 — pure helpers. The database is the authority
 * (estoque_termo_busca_canonico enforces the same rules and every write
 * RPC re-validates); this mirror only gives instant feedback before the
 * round-trip and keeps the error-code -> message mapping in one place.
 */

const TERMO_ALLOWED_PATTERN = /^[a-z0-9áàâãäéèêëíìîïóòôõöúùûüçñ -]+$/;

/**
 * Canonical form of a term as the RPC will store it: trimmed, whitespace
 * collapsed, lower-case, accents preserved. Returns null when the value
 * would be rejected server-side (TERMO_INVALIDO).
 */
export function canonicalizarTermoBusca(input: string): string | null {
  const termo = input.replace(/\s+/g, " ").trim().toLowerCase();
  if (termo.length < TERMO_BUSCA_MIN_CHARS || termo.length > TERMO_BUSCA_MAX_CHARS) return null;
  if (!TERMO_ALLOWED_PATTERN.test(termo) || !/[a-z0-9]/.test(termo)) return null;
  return termo;
}

const RPC_ERROR_MESSAGES: Record<string, string> = {
  TERMO_INVALIDO: TERMOS_BUSCA_ERRO_INVALIDO_MESSAGE,
  PRODUTO_INVALIDO: TERMOS_BUSCA_ERRO_GENERICO_MESSAGE,
  TERMO_JA_APROVADO: TERMOS_BUSCA_ERRO_JA_APROVADO_MESSAGE,
  TERMO_JA_PENDENTE: TERMOS_BUSCA_ERRO_JA_PENDENTE_MESSAGE,
  TERMO_DESATIVADO_PELA_GESTAO: TERMOS_BUSCA_ERRO_DESATIVADO_MESSAGE,
  SEM_PERMISSAO_TERMOS_BUSCA: TERMOS_BUSCA_ERRO_SEM_PERMISSAO_MESSAGE,
  TRANSICAO_INVALIDA: TERMOS_BUSCA_ERRO_TRANSICAO_MESSAGE,
  TERMO_NAO_ENCONTRADO: TERMOS_BUSCA_ERRO_TRANSICAO_MESSAGE,
};

/**
 * Maps the `raise exception ... message = '<CODE>'` codes of the termos de
 * busca RPCs to employee-facing copy. `admin` swaps the deactivated-term
 * message for the management wording (points at Reativar instead of
 * "removed by management"). Session errors are handled upstream by
 * useSessionErrorHandler and never reach here.
 */
export function getTermoBuscaErrorMessage(error: unknown, admin = false): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return TERMOS_BUSCA_ERRO_GENERICO_MESSAGE;
  if (admin && message === "TERMO_DESATIVADO_PELA_GESTAO") {
    return TERMOS_BUSCA_ERRO_DESATIVADO_ADMIN_MESSAGE;
  }
  return RPC_ERROR_MESSAGES[message] ?? TERMOS_BUSCA_ERRO_GENERICO_MESSAGE;
}
