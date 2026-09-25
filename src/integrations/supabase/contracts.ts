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

// Milestone 4D.1 — draft resume. One row per get_or_start_contagem_ativa
// result: header columns repeated per saved item, id_item/pacotes_fechados/
// unidades_avulsas null on the lone row returned for a brand-new draft with
// nothing autosaved yet (see 20260912_001_add_contagem_draft_resume.sql).
export interface ContagemAtivaLinha {
  id_contagem: string;
  iniciado_por_nome: string;
  iniciado_em: string;
  id_item: string | null;
  pacotes_fechados: number | null;
  unidades_avulsas: number | null;
}

export function isContagemAtivaLinha(value: unknown): value is ContagemAtivaLinha {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id_contagem === "string" &&
    candidate.id_contagem.length > 0 &&
    typeof candidate.iniciado_por_nome === "string" &&
    typeof candidate.iniciado_em === "string" &&
    (candidate.id_item === null || typeof candidate.id_item === "string") &&
    (candidate.pacotes_fechados === null || typeof candidate.pacotes_fechados === "number") &&
    (candidate.unidades_avulsas === null || typeof candidate.unidades_avulsas === "number")
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

// =============================================================================
// Milestone 4E — Consulta de Estoque UI V1. Matches the read RPCs in
// 20260909_003_add_consulta_estoque_read_rpcs.sql (and the labelled-grade
// filter in 20260909_004). Every RPC resolves the session server-side and
// reads only from the latest successful sync. cor_descricao_linx is NEVER
// returned; when a snapshot colour has no dictionary entry, cor_nome_portal /
// cor_familia come back null and cor_codigo is preserved.
// =============================================================================

// buscar_produtos_estoque: one row per produto. Prefix hits on produto rank
// first, partial desc_produto matches second. cores_disponiveis / unidades_total
// are Postgres integer/bigint casts, serialized as JSON numbers.
export interface EstoqueProdutoBusca {
  produto: string;
  desc_produto: string | null;
  tipo_produto: string | null;
  linha: string | null;
  cores_disponiveis: number;
  unidades_total: number;
}

export function isEstoqueProdutoBusca(value: unknown): value is EstoqueProdutoBusca {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.produto === "string" &&
    candidate.produto.length > 0 &&
    (candidate.desc_produto === null || typeof candidate.desc_produto === "string") &&
    (candidate.tipo_produto === null || typeof candidate.tipo_produto === "string") &&
    (candidate.linha === null || typeof candidate.linha === "string") &&
    typeof candidate.cores_disponiveis === "number" &&
    typeof candidate.unidades_total === "number"
  );
}

// get_produto_estoque_detalhe: one row per (cor_codigo, tamanho_key) for one
// exact produto, restricted to the labelled grade (tamanho_venda is never
// null here). Zero-quantity sizes are included — the UI renders them blank.
// tamanho_key is internal ordering metadata only and is never shown.
//
// Milestone Price V1 (20260914_002): `preco` is the full/list price for this
// produto+cor (never per-size — repeated on every size row of the same
// colour, same precedent as desc_produto/cor_nome_portal). null means no R3
// price was found for this produto/cor; the UI shows "—", never a
// manufactured value.
export interface EstoqueProdutoDetalheLinha {
  produto: string;
  desc_produto: string | null;
  tipo_produto: string | null;
  linha: string | null;
  cor_codigo: string;
  cor_nome_portal: string | null;
  cor_familia: string | null;
  tamanho_key: number;
  tamanho_venda: string;
  quantidade_estoque: number;
  preco: number | null;
  sync_concluido_em: string;
}

export function isEstoqueProdutoDetalheLinha(value: unknown): value is EstoqueProdutoDetalheLinha {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.produto === "string" &&
    candidate.produto.length > 0 &&
    (candidate.desc_produto === null || typeof candidate.desc_produto === "string") &&
    (candidate.tipo_produto === null || typeof candidate.tipo_produto === "string") &&
    (candidate.linha === null || typeof candidate.linha === "string") &&
    typeof candidate.cor_codigo === "string" &&
    candidate.cor_codigo.length > 0 &&
    (candidate.cor_nome_portal === null || typeof candidate.cor_nome_portal === "string") &&
    (candidate.cor_familia === null || typeof candidate.cor_familia === "string") &&
    typeof candidate.tamanho_key === "number" &&
    typeof candidate.tamanho_venda === "string" &&
    candidate.tamanho_venda.length > 0 &&
    typeof candidate.quantidade_estoque === "number" &&
    (candidate.preco === null || typeof candidate.preco === "number") &&
    typeof candidate.sync_concluido_em === "string"
  );
}

// =============================================================================
// Escala Admin upload (V1.1). Matches escala_processar_importacao and
// get_escala_publicacoes_historico in
// 20260914_004_add_escala_processar_importacao_rpc.sql /
// 20260914_006_fix_escala_historico_stable_session_bug.sql. The raw workbook
// status values ("trabalho"/"folga"/"ferias") are distinct from EscalaSecao
// above — EscalaSecao is the derived display section (manha/tarde/...),
// while these are the literal escala_entradas.status values the import RPC
// reads/writes.
// =============================================================================

export type EscalaEntradaStatus = "trabalho" | "folga" | "ferias";

const ESCALA_ENTRADA_STATUSES: readonly EscalaEntradaStatus[] = ["trabalho", "folga", "ferias"];

function isEscalaEntradaStatusOrNull(value: unknown): value is EscalaEntradaStatus | null {
  return (
    value === null ||
    (typeof value === "string" && ESCALA_ENTRADA_STATUSES.includes(value as EscalaEntradaStatus))
  );
}

export type EscalaImportacaoStatus = "bloqueado" | "pronto" | "publicado";

const ESCALA_IMPORTACAO_STATUSES: readonly EscalaImportacaoStatus[] = [
  "bloqueado",
  "pronto",
  "publicado",
];

export interface EscalaImportacaoMensagem {
  codigo: string;
  mensagem: string;
}

function isEscalaImportacaoMensagem(value: unknown): value is EscalaImportacaoMensagem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.codigo === "string" && typeof candidate.mensagem === "string";
}

export type EscalaImportacaoDiffTipo = "adicionado" | "removido" | "alterado";

const ESCALA_DIFF_TIPOS: readonly EscalaImportacaoDiffTipo[] = [
  "adicionado",
  "removido",
  "alterado",
];

export interface EscalaImportacaoDiffItem {
  tipo: EscalaImportacaoDiffTipo;
  id_funcionario: string;
  apelido: string;
  data: string;
  de_status: EscalaEntradaStatus | null;
  de_hora_inicio: string | null;
  de_hora_fim: string | null;
  para_status: EscalaEntradaStatus | null;
  para_hora_inicio: string | null;
  para_hora_fim: string | null;
}

function isEscalaImportacaoDiffItem(value: unknown): value is EscalaImportacaoDiffItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tipo === "string" &&
    ESCALA_DIFF_TIPOS.includes(candidate.tipo as EscalaImportacaoDiffTipo) &&
    typeof candidate.id_funcionario === "string" &&
    typeof candidate.apelido === "string" &&
    typeof candidate.data === "string" &&
    isEscalaEntradaStatusOrNull(candidate.de_status) &&
    (candidate.de_hora_inicio === null || typeof candidate.de_hora_inicio === "string") &&
    (candidate.de_hora_fim === null || typeof candidate.de_hora_fim === "string") &&
    isEscalaEntradaStatusOrNull(candidate.para_status) &&
    (candidate.para_hora_inicio === null || typeof candidate.para_hora_inicio === "string") &&
    (candidate.para_hora_fim === null || typeof candidate.para_hora_fim === "string")
  );
}

export interface EscalaImportacaoContadores {
  funcionarios: number;
  dias: number;
  registros: number;
}

export interface EscalaImportacaoResultado {
  status: EscalaImportacaoStatus;
  mes_referencia: string;
  bloqueios: EscalaImportacaoMensagem[];
  avisos: EscalaImportacaoMensagem[];
  diff: EscalaImportacaoDiffItem[];
  contadores: EscalaImportacaoContadores;
  is_revisao: boolean | null;
  publicacao_id: string | null;
  publicacao_anterior_id: string | null;
}

export function isEscalaImportacaoResultado(value: unknown): value is EscalaImportacaoResultado {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.status !== "string" ||
    !ESCALA_IMPORTACAO_STATUSES.includes(candidate.status as EscalaImportacaoStatus) ||
    typeof candidate.mes_referencia !== "string" ||
    !Array.isArray(candidate.bloqueios) ||
    !candidate.bloqueios.every(isEscalaImportacaoMensagem) ||
    !Array.isArray(candidate.avisos) ||
    !candidate.avisos.every(isEscalaImportacaoMensagem) ||
    !Array.isArray(candidate.diff) ||
    !candidate.diff.every(isEscalaImportacaoDiffItem) ||
    typeof candidate.contadores !== "object" ||
    candidate.contadores === null ||
    (candidate.is_revisao !== null && typeof candidate.is_revisao !== "boolean") ||
    (candidate.publicacao_id !== null && typeof candidate.publicacao_id !== "string") ||
    (candidate.publicacao_anterior_id !== null &&
      typeof candidate.publicacao_anterior_id !== "string")
  ) {
    return false;
  }
  const contadores = candidate.contadores as Record<string, unknown>;
  return (
    typeof contadores.funcionarios === "number" &&
    typeof contadores.dias === "number" &&
    typeof contadores.registros === "number"
  );
}

export interface EscalaPublicacaoHistorico {
  id: string;
  mes_referencia: string;
  publicado_em: string;
  publicado_por_nome: string;
  nome_arquivo: string | null;
  ativa: boolean;
  total_registros: number;
  versao: number;
}

export function isEscalaPublicacaoHistorico(value: unknown): value is EscalaPublicacaoHistorico {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.mes_referencia === "string" &&
    typeof candidate.publicado_em === "string" &&
    typeof candidate.publicado_por_nome === "string" &&
    (candidate.nome_arquivo === null || typeof candidate.nome_arquivo === "string") &&
    typeof candidate.ativa === "boolean" &&
    typeof candidate.total_registros === "number" &&
    typeof candidate.versao === "number"
  );
}

// get_estoque_freshness: zero or one row. The timestamp is the completion of
// the latest successful complete inventory sync (a failed/in-progress
// execution is invisible to this RPC by construction).
export interface EstoqueFreshness {
  sync_concluido_em: string;
}

export function isEstoqueFreshness(value: unknown): value is EstoqueFreshness {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.sync_concluido_em === "string" && candidate.sync_concluido_em.length > 0;
}

// -----------------------------------------------------------------------------
// Consulta de Estoque — Termos de busca V1 (20260915_001).
// -----------------------------------------------------------------------------

export type TermoBuscaStatus = "pendente" | "aprovado" | "rejeitado" | "desativado";

const TERMO_BUSCA_STATUSES: readonly TermoBuscaStatus[] = [
  "pendente",
  "aprovado",
  "rejeitado",
  "desativado",
];

function isTermoBuscaStatus(value: unknown): value is TermoBuscaStatus {
  return typeof value === "string" && (TERMO_BUSCA_STATUSES as readonly string[]).includes(value);
}

// get_produto_termos_busca: approved terms of one produto plus the caller's
// own pending suggestions — never other employees' pending/rejected rows.
export interface ProdutoTermoBusca {
  id: string;
  termo: string;
  status: TermoBuscaStatus;
}

export function isProdutoTermoBusca(value: unknown): value is ProdutoTermoBusca {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.termo === "string" &&
    candidate.termo.length > 0 &&
    isTermoBuscaStatus(candidate.status)
  );
}

// get_termos_busca_pendentes: the moderation queue, oldest first, with the
// context an admin needs to decide (current approved terms of the produto and
// how many OTHER produtos already carry the same term as approved).
export interface TermoBuscaPendente {
  id: string;
  produto: string;
  desc_produto: string | null;
  termo: string;
  sugerido_por_nome: string;
  sugerido_em: string;
  termos_aprovados: string[];
  outros_produtos_mesmo_termo: number;
}

export function isTermoBuscaPendente(value: unknown): value is TermoBuscaPendente {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.produto === "string" &&
    candidate.produto.length > 0 &&
    (candidate.desc_produto === null || typeof candidate.desc_produto === "string") &&
    typeof candidate.termo === "string" &&
    typeof candidate.sugerido_por_nome === "string" &&
    typeof candidate.sugerido_em === "string" &&
    Array.isArray(candidate.termos_aprovados) &&
    candidate.termos_aprovados.every((t) => typeof t === "string") &&
    typeof candidate.outros_produtos_mesmo_termo === "number"
  );
}

// get_termos_busca_produto_admin: every row of one produto (all statuses)
// with its audit trail. `termo` is the current/final value; `termo_sugerido`
// is what was originally submitted (differs only after "Editar e aprovar").
export interface TermoBuscaAdmin {
  id: string;
  termo: string;
  termo_sugerido: string;
  status: TermoBuscaStatus;
  origem: "sugestao" | "admin";
  sugerido_por_nome: string;
  sugerido_em: string;
  moderado_por_nome: string | null;
  moderado_em: string | null;
  desativado_por_nome: string | null;
  desativado_em: string | null;
  reativado_em: string | null;
}

export function isTermoBuscaAdmin(value: unknown): value is TermoBuscaAdmin {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const optionalString = (v: unknown) => v === null || typeof v === "string";
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.termo === "string" &&
    typeof candidate.termo_sugerido === "string" &&
    isTermoBuscaStatus(candidate.status) &&
    (candidate.origem === "sugestao" || candidate.origem === "admin") &&
    typeof candidate.sugerido_por_nome === "string" &&
    typeof candidate.sugerido_em === "string" &&
    optionalString(candidate.moderado_por_nome) &&
    optionalString(candidate.moderado_em) &&
    optionalString(candidate.desativado_por_nome) &&
    optionalString(candidate.desativado_em) &&
    optionalString(candidate.reativado_em)
  );
}

// =============================================================================
// Limpeza V1 — Varrer / Passar pano automated cleaning assignments. See
// supabase/migrations/20260925_101_add_limpeza_schema.sql and
// 20260925_102_add_limpeza_rpcs.sql.
// =============================================================================

export type LimpezaTurno = "manha" | "tarde";
export type LimpezaTarefa = "varrer" | "passar_pano";
export type LimpezaStatus = "pendente" | "concluida" | "conflito" | "sem_candidato";

const LIMPEZA_TURNOS: readonly LimpezaTurno[] = ["manha", "tarde"];
const LIMPEZA_TAREFAS: readonly LimpezaTarefa[] = ["varrer", "passar_pano"];
const LIMPEZA_STATUS: readonly LimpezaStatus[] = [
  "pendente",
  "concluida",
  "conflito",
  "sem_candidato",
];

// get_limpeza_dia — one calendar day's four slots (manha/tarde x
// varrer/passar_pano). funcionario_* are null only when status is
// sem_candidato (generation found nobody eligible that shift).
export interface LimpezaAtribuicaoDia {
  id: string;
  data: string;
  turno: LimpezaTurno;
  tarefa: LimpezaTarefa;
  funcionario_id: string | null;
  funcionario_nome: string | null;
  funcionario_apelido: string | null;
  origem: "automatica" | "manual";
  bloqueada: boolean;
  status: LimpezaStatus;
  concluido_por_apelido: string | null;
  concluido_em: string | null;
  conflito_motivo: string | null;
}

export function isLimpezaAtribuicaoDia(value: unknown): value is LimpezaAtribuicaoDia {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const optionalString = (v: unknown) => v === null || typeof v === "string";
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.data === "string" &&
    typeof candidate.turno === "string" &&
    LIMPEZA_TURNOS.includes(candidate.turno as LimpezaTurno) &&
    typeof candidate.tarefa === "string" &&
    LIMPEZA_TAREFAS.includes(candidate.tarefa as LimpezaTarefa) &&
    optionalString(candidate.funcionario_id) &&
    optionalString(candidate.funcionario_nome) &&
    optionalString(candidate.funcionario_apelido) &&
    (candidate.origem === "automatica" || candidate.origem === "manual") &&
    typeof candidate.bloqueada === "boolean" &&
    typeof candidate.status === "string" &&
    LIMPEZA_STATUS.includes(candidate.status as LimpezaStatus) &&
    optionalString(candidate.concluido_por_apelido) &&
    optionalString(candidate.concluido_em) &&
    optionalString(candidate.conflito_motivo)
  );
}

// get_limpeza_mes — one row per currently-eligible funcionario, alphabetical.
export interface LimpezaResumoMensal {
  funcionario_id: string;
  funcionario_nome: string;
  funcionario_apelido: string;
  varrer_atribuidos: number;
  passar_pano_atribuidos: number;
  total: number;
  concluidos: number;
  pendentes: number;
}

export function isLimpezaResumoMensal(value: unknown): value is LimpezaResumoMensal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.funcionario_id === "string" &&
    typeof candidate.funcionario_nome === "string" &&
    typeof candidate.funcionario_apelido === "string" &&
    typeof candidate.varrer_atribuidos === "number" &&
    typeof candidate.passar_pano_atribuidos === "number" &&
    typeof candidate.total === "number" &&
    typeof candidate.concluidos === "number" &&
    typeof candidate.pendentes === "number"
  );
}

// get_limpeza_gerencial_mes — Gerente/Administrador exceptions list:
// conflicts, manual overrides, sem_candidato slots, missed (past+pendente).
export interface LimpezaGerencialItem {
  id: string;
  data: string;
  turno: LimpezaTurno;
  tarefa: LimpezaTarefa;
  funcionario_apelido: string | null;
  origem: "automatica" | "manual";
  bloqueada: boolean;
  status: LimpezaStatus;
  conflito_motivo: string | null;
  atrasada: boolean;
}

export function isLimpezaGerencialItem(value: unknown): value is LimpezaGerencialItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const optionalString = (v: unknown) => v === null || typeof v === "string";
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.data === "string" &&
    typeof candidate.turno === "string" &&
    LIMPEZA_TURNOS.includes(candidate.turno as LimpezaTurno) &&
    typeof candidate.tarefa === "string" &&
    LIMPEZA_TAREFAS.includes(candidate.tarefa as LimpezaTarefa) &&
    optionalString(candidate.funcionario_apelido) &&
    (candidate.origem === "automatica" || candidate.origem === "manual") &&
    typeof candidate.bloqueada === "boolean" &&
    typeof candidate.status === "string" &&
    LIMPEZA_STATUS.includes(candidate.status as LimpezaStatus) &&
    optionalString(candidate.conflito_motivo) &&
    typeof candidate.atrasada === "boolean"
  );
}

// limpeza_concluir_atribuicao — single-row result.
export interface LimpezaConclusao {
  id: string;
  status: LimpezaStatus;
  concluido_por_apelido: string | null;
  concluido_em: string | null;
}

export function isLimpezaConclusao(value: unknown): value is LimpezaConclusao {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const optionalString = (v: unknown) => v === null || typeof v === "string";
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.status === "string" &&
    LIMPEZA_STATUS.includes(candidate.status as LimpezaStatus) &&
    optionalString(candidate.concluido_por_apelido) &&
    optionalString(candidate.concluido_em)
  );
}

// get_limpeza_sync_pendencias — Gerente/Administrador only: dates whose most
// recent Escala-publish-triggered (or manual) sync attempt is unresolved.
export interface LimpezaSyncPendencia {
  data: string;
  falhou_em: string;
  motivo: string | null;
}

export function isLimpezaSyncPendencia(value: unknown): value is LimpezaSyncPendencia {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.data === "string" &&
    typeof candidate.falhou_em === "string" &&
    (candidate.motivo === null || typeof candidate.motivo === "string")
  );
}
