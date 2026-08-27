export interface Employee {
  funcionario_id: string;
  nome: string;
}

export interface VerifyPinSuccess {
  success: true;
  funcionario_id: string;
  /** Full/legal name (funcionarios.nome). */
  nome: string;
  /** Employee-facing informal identity (funcionarios.apelido), falls back to nome server-side. */
  apelido: string;
  cargo: string;
  error_code: null;
  session_token: string;
}

export interface VerifyPinFailure {
  success: false;
  funcionario_id: string | null;
  nome: string | null;
  apelido: string | null;
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
    typeof candidate.apelido === "string" &&
    candidate.apelido.length > 0 &&
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

export type AtendimentoStatus = "ativo" | "finalizando" | "pendente_fechamento";

const ATENDIMENTO_STATUSES: readonly AtendimentoStatus[] = [
  "ativo",
  "finalizando",
  "pendente_fechamento",
];

export interface AtendimentoAtivo {
  id: string;
  status: AtendimentoStatus;
  iniciado_em: string;
  fora_de_ordem: boolean;
  prazo_provisorio_em: string;
  iniciado_por_nome: string | null;
  checklist_obrigatorio: boolean | null;
  // Milestone 2D: the Manaus calendar date (YYYY-MM-DD) this Atendimento
  // originally belonged to — only meaningful once status is
  // "pendente_fechamento" (drives the recovery screen's contextual date
  // copy); null for a same-day ativo/finalizando Atendimento.
  dia_negocio_original: string | null;
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
    (candidate.iniciado_por_nome === null || typeof candidate.iniciado_por_nome === "string") &&
    (candidate.checklist_obrigatorio === null ||
      typeof candidate.checklist_obrigatorio === "boolean") &&
    (candidate.dia_negocio_original === null || typeof candidate.dia_negocio_original === "string")
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

export interface AtendimentoChecklistItem {
  id: string;
  versao: number;
  codigo: string;
  titulo: string;
  guia_bullets: string[] | null;
  ordem_exibicao: number;
  obrigatorio: boolean;
}

export function isAtendimentoChecklistItem(value: unknown): value is AtendimentoChecklistItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.versao === "number" &&
    typeof candidate.codigo === "string" &&
    candidate.codigo.length > 0 &&
    typeof candidate.titulo === "string" &&
    (candidate.guia_bullets === null ||
      (Array.isArray(candidate.guia_bullets) &&
        candidate.guia_bullets.every((bullet) => typeof bullet === "string"))) &&
    typeof candidate.ordem_exibicao === "number" &&
    typeof candidate.obrigatorio === "boolean"
  );
}

export type ChecklistPolicy = "required" | "defer_allowed" | "periodic_verification";

const CHECKLIST_POLICIES: readonly ChecklistPolicy[] = [
  "required",
  "defer_allowed",
  "periodic_verification",
];

export function isChecklistPolicy(value: unknown): value is ChecklistPolicy {
  return typeof value === "string" && CHECKLIST_POLICIES.includes(value as ChecklistPolicy);
}

// Milestone 4C.1: matches escala_classificar_turno's output plus the two
// non-shift statuses and the "missing data" fallback — see
// 20260825_003_add_escala_schema.sql / 20260825_004_add_escala_read_rpcs.sql.
// Milestone 4C.2 (browser QA): the dedicated "gestao" section was dropped —
// gerência employees are now classified into the normal shift buckets
// (20260826_002_bucket_gestao_into_normal_sections.sql). Their hours come
// back null from the RPC, so their rows render name-only.
export type EscalaSecao = "manha" | "intermediario" | "tarde" | "folga" | "ferias" | "a_confirmar";

const ESCALA_SECOES: readonly EscalaSecao[] = [
  "manha",
  "intermediario",
  "tarde",
  "folga",
  "ferias",
  "a_confirmar",
];

export type FeriadoAbrangencia = "nacional" | "estadual" | "municipal";

const FERIADO_ABRANGENCIAS: readonly FeriadoAbrangencia[] = ["nacional", "estadual", "municipal"];

export interface EscalaEntradaPeriodo {
  data: string;
  id_funcionario: string;
  nome: string;
  apelido: string;
  secao: EscalaSecao;
  hora_inicio: string | null;
  hora_fim: string | null;
  feriado_nome: string | null;
  feriado_abrangencia: FeriadoAbrangencia | null;
}

export function isEscalaEntradaPeriodo(value: unknown): value is EscalaEntradaPeriodo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.data === "string" &&
    typeof candidate.id_funcionario === "string" &&
    candidate.id_funcionario.length > 0 &&
    typeof candidate.nome === "string" &&
    typeof candidate.apelido === "string" &&
    typeof candidate.secao === "string" &&
    ESCALA_SECOES.includes(candidate.secao as EscalaSecao) &&
    (candidate.hora_inicio === null || typeof candidate.hora_inicio === "string") &&
    (candidate.hora_fim === null || typeof candidate.hora_fim === "string") &&
    (candidate.feriado_nome === null || typeof candidate.feriado_nome === "string") &&
    (candidate.feriado_abrangencia === null ||
      (typeof candidate.feriado_abrangencia === "string" &&
        FERIADO_ABRANGENCIAS.includes(candidate.feriado_abrangencia as FeriadoAbrangencia)))
  );
}

export interface EscalaEntradaMes {
  data: string;
  secao: EscalaSecao;
  hora_inicio: string | null;
  hora_fim: string | null;
  feriado_nome: string | null;
  feriado_abrangencia: FeriadoAbrangencia | null;
}

export function isEscalaEntradaMes(value: unknown): value is EscalaEntradaMes {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.data === "string" &&
    typeof candidate.secao === "string" &&
    ESCALA_SECOES.includes(candidate.secao as EscalaSecao) &&
    (candidate.hora_inicio === null || typeof candidate.hora_inicio === "string") &&
    (candidate.hora_fim === null || typeof candidate.hora_fim === "string") &&
    (candidate.feriado_nome === null || typeof candidate.feriado_nome === "string") &&
    (candidate.feriado_abrangencia === null ||
      (typeof candidate.feriado_abrangencia === "string" &&
        FERIADO_ABRANGENCIAS.includes(candidate.feriado_abrangencia as FeriadoAbrangencia)))
  );
}

export interface EscalaMesPublicado {
  mes_referencia: string;
  publicado_em: string;
}

export function isEscalaMesPublicado(value: unknown): value is EscalaMesPublicado {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.mes_referencia === "string" && typeof candidate.publicado_em === "string";
}

// =============================================================================
// Milestone 4D — Contagem de Embalagens V1. Matches the RPCs in
// 20260827_001_add_contagem_embalagens.sql. All numeric totals are returned
// by Postgres as `bigint`/`int` casts, which PostgREST serializes as JSON
// numbers — hence `number`, not `string`, in the guards below.
// =============================================================================

export type ContagemStatus = "pendente_revisao" | "revisada";

const CONTAGEM_STATUSES: readonly ContagemStatus[] = ["pendente_revisao", "revisada"];

export interface ContagemCatalogoItem {
  id: string;
  familia: string;
  tamanho: string;
  rotulo: string;
  unidades_por_pacote: number;
  ordem_exibicao: number;
}

export function isContagemCatalogoItem(value: unknown): value is ContagemCatalogoItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.familia === "string" &&
    typeof candidate.tamanho === "string" &&
    typeof candidate.rotulo === "string" &&
    candidate.rotulo.length > 0 &&
    typeof candidate.unidades_por_pacote === "number" &&
    candidate.unidades_por_pacote > 0 &&
    typeof candidate.ordem_exibicao === "number"
  );
}

export interface ContagemPendente {
  id: string;
  submetido_por_nome: string;
  submetido_em: string;
  observacao: string | null;
  total_itens: number;
}

export function isContagemPendente(value: unknown): value is ContagemPendente {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.submetido_por_nome === "string" &&
    typeof candidate.submetido_em === "string" &&
    (candidate.observacao === null || typeof candidate.observacao === "string") &&
    typeof candidate.total_itens === "number"
  );
}

export interface ContagemHistoricoRegistro {
  id: string;
  submetido_por_nome: string;
  submetido_em: string;
  observacao: string | null;
  revisada_por_nome: string | null;
  revisada_em: string | null;
  total_itens: number;
}

export function isContagemHistoricoRegistro(value: unknown): value is ContagemHistoricoRegistro {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.submetido_por_nome === "string" &&
    typeof candidate.submetido_em === "string" &&
    (candidate.observacao === null || typeof candidate.observacao === "string") &&
    (candidate.revisada_por_nome === null || typeof candidate.revisada_por_nome === "string") &&
    (candidate.revisada_em === null || typeof candidate.revisada_em === "string") &&
    typeof candidate.total_itens === "number"
  );
}

// get_contagem_detalhe returns one row per item, each carrying the
// submission-header columns (repeated) so the client renders header + table
// from one payload — same idiom as get_escala_periodo's feriado columns.
export interface ContagemDetalheLinha {
  id_contagem: string;
  submetido_por_nome: string;
  submetido_em: string;
  status: ContagemStatus;
  observacao: string | null;
  revisada_por_nome: string | null;
  revisada_em: string | null;
  id_item: string;
  rotulo: string;
  familia: string;
  tamanho: string;
  unidades_por_pacote: number;
  pacotes_fechados: number;
  unidades_avulsas: number;
  total_unidades: number;
}

export function isContagemDetalheLinha(value: unknown): value is ContagemDetalheLinha {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id_contagem === "string" &&
    candidate.id_contagem.length > 0 &&
    typeof candidate.submetido_por_nome === "string" &&
    typeof candidate.submetido_em === "string" &&
    typeof candidate.status === "string" &&
    CONTAGEM_STATUSES.includes(candidate.status as ContagemStatus) &&
    (candidate.observacao === null || typeof candidate.observacao === "string") &&
    (candidate.revisada_por_nome === null || typeof candidate.revisada_por_nome === "string") &&
    (candidate.revisada_em === null || typeof candidate.revisada_em === "string") &&
    typeof candidate.id_item === "string" &&
    typeof candidate.rotulo === "string" &&
    typeof candidate.familia === "string" &&
    typeof candidate.tamanho === "string" &&
    typeof candidate.unidades_por_pacote === "number" &&
    typeof candidate.pacotes_fechados === "number" &&
    typeof candidate.unidades_avulsas === "number" &&
    typeof candidate.total_unidades === "number"
  );
}
