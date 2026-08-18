export interface Employee {
  funcionario_id: string;
  nome: string;
}

export interface VerifyPinSuccess {
  success: true;
  funcionario_id: string;
  nome: string;
  cargo: string;
  error_code: null;
  session_token: string;
}

export interface VerifyPinFailure {
  success: false;
  funcionario_id: string | null;
  nome: string | null;
  cargo: string | null;
  error_code: "INVALID_INPUT" | "INVALID_CREDENTIALS";
  session_token: null;
}

export type VerifyPinResult = VerifyPinSuccess | VerifyPinFailure;

export function isEmployee(value: unknown): value is Employee {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.funcionario_id === "string" &&
    candidate.funcionario_id.length > 0 &&
    typeof candidate.nome === "string"
  );
}

export function isVerifyPinSuccess(value: unknown): value is VerifyPinSuccess {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.success === true &&
    typeof candidate.funcionario_id === "string" &&
    candidate.funcionario_id.length > 0 &&
    typeof candidate.nome === "string" &&
    candidate.nome.length > 0 &&
    typeof candidate.cargo === "string" &&
    candidate.cargo.length > 0 &&
    typeof candidate.session_token === "string" &&
    candidate.session_token.length > 0
  );
}

export interface ListaVezEntry {
  id_funcionario: string;
  nome: string;
  em_atendimento: boolean;
  ordem: number | null;
  iniciado_em: string | null;
}

export function isListaVezEntry(value: unknown): value is ListaVezEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id_funcionario === "string" &&
    candidate.id_funcionario.length > 0 &&
    typeof candidate.nome === "string" &&
    typeof candidate.em_atendimento === "boolean" &&
    (candidate.ordem === null || typeof candidate.ordem === "number") &&
    (candidate.iniciado_em === null || typeof candidate.iniciado_em === "string")
  );
}

export interface AtendimentoAtivo {
  id: string;
  iniciado_em: string;
  fora_de_ordem: boolean;
  prazo_provisorio_em: string;
}

export function isAtendimentoAtivo(value: unknown): value is AtendimentoAtivo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.iniciado_em === "string" &&
    typeof candidate.fora_de_ordem === "boolean" &&
    typeof candidate.prazo_provisorio_em === "string"
  );
}
