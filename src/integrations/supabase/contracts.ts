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

export type ListaVezStatus = "disponivel" | "em_atendimento" | "finalizando";

const LISTA_VEZ_STATUSES: readonly ListaVezStatus[] = [
  "disponivel",
  "em_atendimento",
  "finalizando",
];

export interface ListaVezEntry {
  id_funcionario: string;
  nome: string;
  status: ListaVezStatus;
  ordem: number | null;
  iniciado_em: string | null;
  id_atendimento: string | null;
  id_funcionario_iniciador: string | null;
  prazo_provisorio_em: string | null;
}

export function isListaVezEntry(value: unknown): value is ListaVezEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id_funcionario === "string" &&
    candidate.id_funcionario.length > 0 &&
    typeof candidate.nome === "string" &&
    typeof candidate.status === "string" &&
    LISTA_VEZ_STATUSES.includes(candidate.status as ListaVezStatus) &&
    (candidate.ordem === null || typeof candidate.ordem === "number") &&
    (candidate.iniciado_em === null || typeof candidate.iniciado_em === "string") &&
    (candidate.id_atendimento === null || typeof candidate.id_atendimento === "string") &&
    (candidate.id_funcionario_iniciador === null ||
      typeof candidate.id_funcionario_iniciador === "string") &&
    (candidate.prazo_provisorio_em === null || typeof candidate.prazo_provisorio_em === "string")
  );
}

export type AtendimentoStatus = "ativo" | "finalizando";

const ATENDIMENTO_STATUSES: readonly AtendimentoStatus[] = ["ativo", "finalizando"];

export interface AtendimentoAtivo {
  id: string;
  status: AtendimentoStatus;
  iniciado_em: string;
  fora_de_ordem: boolean;
  prazo_provisorio_em: string;
  iniciado_por_nome: string | null;
}

export function isAtendimentoAtivo(value: unknown): value is AtendimentoAtivo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.status === "string" &&
    ATENDIMENTO_STATUSES.includes(candidate.status as AtendimentoStatus) &&
    typeof candidate.iniciado_em === "string" &&
    typeof candidate.fora_de_ordem === "boolean" &&
    typeof candidate.prazo_provisorio_em === "string" &&
    (candidate.iniciado_por_nome === null || typeof candidate.iniciado_por_nome === "string")
  );
}

/**
 * iniciar_atendimento's own return shape — deliberately narrower than
 * AtendimentoAtivo. It never returned a status column (a freshly-started
 * Atendimento is always 'ativo' by construction, so there was never
 * anything to disambiguate), and Milestone 2A did not change that RPC's
 * signature. AtendimentoAtivo gained a required status field for
 * get_atendimento_ativo's newer shape; reusing that guard here caused a
 * confirmed bug — iniciar_atendimento's genuinely successful response was
 * rejected by isAtendimentoAtivo for lacking status, throwing client-side
 * after the server had already committed the new Atendimento, surfacing a
 * false "start failed" error while the backend state was actually correct.
 */
export interface AtendimentoIniciado {
  id: string;
  iniciado_em: string;
  fora_de_ordem: boolean;
  prazo_provisorio_em: string;
}

export function isAtendimentoIniciado(value: unknown): value is AtendimentoIniciado {
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

export type MotivoCategoria = "convertido" | "nao_convertido";

const MOTIVO_CATEGORIAS: readonly MotivoCategoria[] = ["convertido", "nao_convertido"];

export interface AtendimentoMotivo {
  id: string;
  codigo: string;
  categoria: MotivoCategoria;
  rotulo: string;
  detalhe_obrigatorio: boolean;
  ordem_exibicao: number;
}

export function isAtendimentoMotivo(value: unknown): value is AtendimentoMotivo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.codigo === "string" &&
    typeof candidate.categoria === "string" &&
    MOTIVO_CATEGORIAS.includes(candidate.categoria as MotivoCategoria) &&
    typeof candidate.rotulo === "string" &&
    typeof candidate.detalhe_obrigatorio === "boolean" &&
    typeof candidate.ordem_exibicao === "number"
  );
}
