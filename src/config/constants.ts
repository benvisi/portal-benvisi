export const PIN_LENGTH = 4;
export const PIN_SHAKE_DURATION_MS = 400;
export const LOGIN_TRANSITION_MS = 180;
export const MOTION_FAST_MS = 180;

export const HAPTIC_TAP_MS = 10;
export const HAPTIC_SUCCESS_PATTERN = [30, 40, 30] as const;
export const HAPTIC_ERROR_PATTERN = [60, 40, 60] as const;

export const TOUCH_TARGET_MIN_PX = 44;
export const KEYPAD_BUTTON_MIN_PX = 64;

export const SESSION_STORAGE_KEY = "benvisi.session";
export const EMPLOYEES_QUERY_KEY = ["employees"] as const;

export const MANAUS_TIMEZONE = "America/Manaus";
export const LOCALE_PT_BR = "pt-BR";

export const LOGIN_ERROR_MESSAGE = "PIN ou usuário incorreto. Tente novamente.";
export const VERIFYING_MESSAGE = "Validando PIN...";
export const SEARCH_PLACEHOLDER = "Buscar por nome...";

export const TERMS_VERSION = "2026.1";

export const TERMS_TITLE = "Termo de Ciência e Uso do Portal Benvisi";

export const TERMS_BODY_PARAGRAPHS = [
  "O Portal Benvisi é uma ferramenta interna de apoio às operações da empresa.",
  "As informações, registros e funcionalidades disponibilizados têm finalidade gerencial e operacional.",
  "O uso desta plataforma não substitui documentos formais, contratos de trabalho, políticas internas, controles legais ou quaisquer outros instrumentos oficiais da empresa.",
  "Ao prosseguir, declaro que li e compreendi as informações acima e estou ciente da finalidade gerencial e operacional do Portal Benvisi.",
] as const;

export const TERMS_FULL_TEXT = TERMS_BODY_PARAGRAPHS.join("\n\n");

export const TERMS_CHECKBOX_LABEL = "Li e declaro estar ciente das informações acima.";
export const TERMS_ACCEPT_BUTTON_LABEL = "Aceitar e continuar";
export const SIGN_OUT_BUTTON_LABEL = "Sair";
export const TERMS_LOADING_MESSAGE = "Verificando aceite do termo...";
export const TERMS_ACCEPT_ERROR_MESSAGE = "Não foi possível registrar seu aceite. Tente novamente.";
export const TERMS_STATUS_ERROR_MESSAGE =
  "Não foi possível verificar o termo de uso. Tente novamente.";

export const ADMINISTRATOR_CARGO = "Administrador";
export const MANAGER_CARGO = "Gerente";

export const DASHBOARD_WELCOME_MESSAGE = "Bem-vindo ao Portal Benvisi.";

export const SHIFT_START_TITLE = "Início de Turno";
export const SHIFT_START_DESCRIPTION = "Registre o início das suas atividades de hoje.";
export const SHIFT_START_BUTTON_LABEL = "Iniciar atividades";
export const SHIFT_START_SUCCESS_LABEL = "Atividades iniciadas";
export const SHIFT_START_ERROR_MESSAGE =
  "Não foi possível registrar o início das atividades. Tente novamente.";

export const MODULE_IN_PROGRESS_TITLE = "Funcionalidade em desenvolvimento";
export const MODULE_IN_PROGRESS_DESCRIPTION =
  "Esta área estará disponível em breve no Portal Benvisi.";
export const MODULE_IN_PROGRESS_ACK_LABEL = "Entendi";

export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Faça login novamente.";

export const ATENDIMENTO_PAGE_TITLE = "Atendimento";
export const VOLTAR_AO_PAINEL_LABEL = "Voltar ao painel";

export const LISTA_DA_VEZ_TITLE = "Lista da Vez";
export const LISTA_DA_VEZ_EMPTY_MESSAGE =
  "Ninguém na fila ainda hoje. Inicie as atividades para entrar na Lista da Vez.";
export const LISTA_DA_VEZ_VOCE_LABEL = "Você";

export const ATENDIMENTO_START_BUTTON_LABEL = "Iniciar atendimento";
export const ATENDIMENTO_COMPLETE_BUTTON_LABEL = "Concluir atendimento";
export const ATENDIMENTO_CANCEL_PROVISORIO_BUTTON_LABEL = "Cancelar início";
export const ATENDIMENTO_UNDO_LABEL = "Desfazer";
export const ATENDIMENTO_ATIVO_LABEL = "Atendimento em andamento";
export const ATENDIMENTO_PROVISORIO_LABEL = "Atendimento provisório";
export const ATENDIMENTO_PROVISORIO_DESCRIPTION =
  "Toque em cancelar caso tenha iniciado por engano.";

export const FORA_DE_ORDEM_CONFIRM_TITLE = "Você não é o próximo da Lista da Vez.";
export const FORA_DE_ORDEM_CONFIRM_DESCRIPTION = "Deseja iniciar este atendimento mesmo assim?";
export const FORA_DE_ORDEM_CONFIRM_ACCEPT_LABEL = "Iniciar atendimento";
export const FORA_DE_ORDEM_CONFIRM_CANCEL_LABEL = "Cancelar";
export const FORA_DE_ORDEM_BADGE_LABEL = "Fora da ordem";

export const ATENDIMENTO_GENERIC_ERROR_MESSAGE =
  "Não foi possível concluir a ação. Tente novamente.";
export const ATIVIDADES_NAO_INICIADAS_MESSAGE =
  "Você precisa iniciar as atividades do dia antes de começar um atendimento.";
export const ATENDIMENTO_ATIVO_EXISTENTE_MESSAGE = "Você já tem um atendimento em andamento.";
export const CONFIRMACAO_FORA_DE_ORDEM_NECESSARIA_MESSAGE =
  "Confirme o início fora da ordem da Lista da Vez.";
export const NENHUM_ATENDIMENTO_ATIVO_MESSAGE = "Não há atendimento ativo para esta ação.";
export const PRAZO_PROVISORIO_EXPIRADO_MESSAGE =
  "O prazo para cancelar este atendimento já passou.";

// Milestone 2D
export const ATENDIMENTO_PENDENTE_FECHAMENTO_MESSAGE =
  "Conclua seu atendimento pendente antes de iniciar um novo atendimento.";
export const NENHUM_ATENDIMENTO_PENDENTE_MESSAGE = "Não há atendimento pendente para esta ação.";

export const FECHAMENTO_STATUS_LABEL = "Finalizando";
export const FECHAMENTO_TITLE = "Finalizar atendimento";
export const FECHAMENTO_SUBTITLE = "Registre os clientes atendidos antes de concluir.";
export const FECHAMENTO_SUBMIT_LABEL = "Concluir atendimento";
export const VOLTAR_AO_ATENDIMENTO_LABEL = "Voltar ao atendimento";

// Milestone 2D: shown instead of FECHAMENTO_TITLE/FECHAMENTO_SUBTITLE when
// closing a previous-day pendente_fechamento Atendimento — deliberately
// neutral/operational ("workflow recovery", never "erro", "irregularidade",
// "falha", or "advertência" — section 25).
export const ATENDIMENTO_PENDENTE_TITLE = "Atendimento pendente de conclusão";
export const ATENDIMENTO_PENDENTE_SUBTITLE =
  "Finalize as informações deste atendimento antes de continuar.";

export function getAtendimentoPendenteDataLabel(dataFormatada: string): string {
  return `Atendimento iniciado em ${dataFormatada}.`;
}

export const CHECKLIST_TITLE = "Checklist de reposição";
export const CHECKLIST_SUBTITLE = "Confirme os três itens antes de concluir o atendimento.";
export const CHECKLIST_LOADING_MESSAGE = "Carregando checklist...";

export const FAREI_DEPOIS_LABEL = "Farei depois";
export const FAREI_DEPOIS_SUPPORT_TEXT = "Você poderá concluir este checklist depois.";

export function getChecklistPendenciasCountLabel(count: number): string {
  return count === 1 ? "1 checklist pendente" : `${count} checklists pendentes`;
}

// Milestone 2C.2: the indicator this labels is now actionable everywhere it
// appears (tap/click opens the standalone completion flow), so the hint
// reflects that instead of the 2C.1 awareness-only framing.
export const CHECKLIST_PENDENCIAS_SUPPORT_TEXT = "Toque para concluir agora.";

export const CHECKLIST_AVULSO_TITLE = "Concluir checklist pendente";
export const CHECKLIST_AVULSO_SUBTITLE =
  "Complete o checklist operacional para concluir seus checklists pendentes.";
export const CHECKLIST_AVULSO_SUBMIT_LABEL = "Concluir checklist";

export function getChecklistAvulsoSuccessMessage(resolvedCount: number): string {
  return resolvedCount === 1
    ? "Checklist concluído."
    : `${resolvedCount} checklists pendentes foram resolvidos.`;
}

export const CLIENTE_CARD_TITLE = "Cliente";
export const ADICIONAR_CLIENTE_LABEL = "Adicionar cliente";
export const REMOVER_CLIENTE_LABEL = "Remover cliente";

export const OUTCOME_CONVERTIDO_LABEL = "Convertido";
export const OUTCOME_NAO_CONVERTIDO_LABEL = "Não convertido";

export const MOTIVO_LABEL = "Motivo";
export const MOTIVOS_LOADING_MESSAGE = "Carregando motivos...";
export const DETALHE_LABEL = "Detalhes";
export const DETALHE_PLACEHOLDER = "Adicione mais detalhes...";

export const FECHAMENTO_UNSAVED_CONFIRM_TITLE = "Descartar dados não salvos?";
export const FECHAMENTO_UNSAVED_CONFIRM_DESCRIPTION =
  "Você preencheu informações de clientes e/ou do checklist que ainda não foram salvas. Deseja realmente sair sem concluir?";
export const FECHAMENTO_UNSAVED_CONFIRM_ACCEPT_LABEL = "Sair sem salvar";
export const FECHAMENTO_UNSAVED_CONFIRM_CANCEL_LABEL = "Continuar preenchendo";

export const NENHUM_CLIENTE_INFORMADO_MESSAGE =
  "Registre pelo menos um cliente antes de concluir o atendimento.";
export const ATENDIMENTO_NAO_ESTA_FINALIZANDO_MESSAGE = "Este atendimento não está em finalização.";
export const MOTIVO_OBRIGATORIO_MESSAGE = "Selecione um motivo para cada cliente.";
export const MOTIVO_INVALIDO_MESSAGE =
  "Motivo inválido ou inativo. Atualize a página e tente novamente.";
export const DETALHE_OBRIGATORIO_MESSAGE = "Adicione detalhes para o motivo selecionado.";
export const CHECKLIST_INCOMPLETO_MESSAGE =
  "Complete os três itens do checklist antes de concluir o atendimento.";
export const CHECKLIST_INDISPONIVEL_MESSAGE =
  "Não foi possível carregar o checklist. Atualize a página e tente novamente.";
export const ADIAMENTO_NAO_PERMITIDO_MESSAGE =
  "Não é mais possível adiar o checklist. Complete-o para concluir o atendimento.";
export const SEM_PERMISSAO_POLITICA_MESSAGE =
  "Você não tem permissão para alterar a política do checklist.";
export const POLITICA_INVALIDA_MESSAGE = "Política de checklist inválida.";
export const SEM_CHECKLIST_PENDENTE_MESSAGE = "Não há checklist pendente no momento.";
export const ATENDIMENTO_ATIVO_IMPEDE_CHECKLIST_AVULSO_MESSAGE =
  "Conclua seu atendimento atual antes de concluir o checklist pendente.";

export const FUNCIONARIO_ALVO_INVALIDO_MESSAGE =
  "Não foi possível identificar esse colaborador. Atualize a página e tente novamente.";
export const FUNCIONARIO_ALVO_INDISPONIVEL_MESSAGE =
  "Esse colaborador não está mais disponível na Lista da Vez.";
export const SEM_PERMISSAO_CANCELAR_MESSAGE =
  "Você não tem permissão para cancelar este atendimento.";

export const SAIR_LISTA_DA_VEZ_LABEL = "Sair da Lista da Vez";
export const ENTRAR_LISTA_DA_VEZ_LABEL = "Entrar na Lista da Vez";
export const LISTA_DA_VEZ_FORA_TITLE = "Você está fora da Lista da Vez.";
export const LISTA_DA_VEZ_FORA_DESCRIPTION = "Entre novamente para voltar à fila.";
export const REMOVER_LISTA_DA_VEZ_ACCEPT_LABEL = "Remover";

export const JA_FORA_DA_LISTA_MESSAGE = "Você já está fora da Lista da Vez.";
export const JA_NA_LISTA_MESSAGE = "Você já está na Lista da Vez.";
export const EM_ATENDIMENTO_NAO_PODE_SAIR_MESSAGE =
  "Conclua seu atendimento antes de sair da Lista da Vez.";
export const FUNCIONARIO_EM_ATENDIMENTO_MESSAGE =
  "Este funcionário está em atendimento e não pode ser removido da Lista da Vez.";
export const SEM_PERMISSAO_REMOVER_MESSAGE =
  "Você não tem permissão para remover este colaborador da Lista da Vez.";

export function getRemoverConfirmTitle(nome: string): string {
  return `Remover ${nome} da Lista da Vez?`;
}

export function getRemoverAriaLabel(nome: string): string {
  return `Remover ${nome} da Lista da Vez`;
}

export const INICIAR_PARA_LABEL = "Iniciar atendimento para";
export const INICIADO_POR_PREFIX = "Iniciado por";

export const DELEGATE_CONFIRM_ACCEPT_LABEL = "Iniciar atendimento";
export const DELEGATE_CONFIRM_CANCEL_LABEL = "Cancelar";

export function getDelegateInOrderConfirmTitle(nome: string): string {
  return `Iniciar atendimento para ${nome}?`;
}

export function getDelegateInOrderConfirmDescription(nome: string): string {
  return `O atendimento será iniciado em nome de ${nome}, não em seu nome.`;
}

export function getDelegateForaDeOrdemConfirmTitle(nome: string): string {
  return `${nome} não está na vez.`;
}

export function getDelegateForaDeOrdemConfirmDescription(nome: string): string {
  return `Deseja iniciar o atendimento para ${nome} mesmo assim?`;
}

export function getIniciarParaAriaLabel(nome: string): string {
  return `${INICIAR_PARA_LABEL} ${nome}`;
}

export function getUndoButtonLabel(secondsLeft: number): string {
  return `${ATENDIMENTO_UNDO_LABEL} · ${secondsLeft}s`;
}

export const ADMINISTRATIVO_PAGE_TITLE = "Administrativo";

export const CHECKLIST_POLICY_SECTION_TITLE = "Política do Checklist";
export const CHECKLIST_POLICY_SECTION_SUBTITLE =
  "Defina se o checklist de reposição é obrigatório ou se pode ser concluído depois.";
export const CHECKLIST_POLICY_LOADING_MESSAGE = "Carregando política...";

export const CHECKLIST_POLICY_REQUIRED_LABEL = "Obrigatório";
export const CHECKLIST_POLICY_REQUIRED_DESCRIPTION =
  "O checklist precisa ser concluído antes de finalizar o atendimento.";
export const CHECKLIST_POLICY_DEFER_ALLOWED_LABEL = "Permitir fazer depois";
export const CHECKLIST_POLICY_DEFER_ALLOWED_DESCRIPTION =
  "O funcionário pode finalizar o atendimento e concluir o checklist posteriormente.";
export const CHECKLIST_POLICY_PERIODIC_LABEL = "Verificação periódica";
export const CHECKLIST_POLICY_PERIODIC_DESCRIPTION =
  "O sistema exige o checklist em alguns atendimentos para manter a rotina de verificação sem torná-la obrigatória em todos.";

// Milestone 2C.3: shown on the closing screen only when this specific
// Atendimento was selected as mandatory under periodic_verification —
// deliberately neutral/operational, never implying random selection or
// audit/surveillance framing.
export const CHECKLIST_OBRIGATORIO_PERIODICO_MESSAGE =
  "Neste atendimento, conclua o checklist antes de finalizar.";

export const CHECKLIST_POLICY_CONFIRM_TITLE = "Alterar política do checklist?";
export const CHECKLIST_POLICY_CONFIRM_ACCEPT_LABEL = "Confirmar";
export const CHECKLIST_POLICY_CONFIRM_CANCEL_LABEL = "Cancelar";

export function getChecklistPolicyConfirmDescription(policyLabel: string): string {
  return `A política do checklist será alterada para "${policyLabel}".`;
}
