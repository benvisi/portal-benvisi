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

export const FECHAMENTO_STATUS_LABEL = "Finalizando";
export const FECHAMENTO_TITLE = "Finalizar atendimento";
export const FECHAMENTO_SUBTITLE = "Registre os clientes atendidos antes de concluir.";
export const FECHAMENTO_SUBMIT_LABEL = "Concluir atendimento";
export const VOLTAR_AO_ATENDIMENTO_LABEL = "Voltar ao atendimento";

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
  "Você preencheu informações de cliente que ainda não foram salvas. Deseja realmente sair sem concluir?";
export const FECHAMENTO_UNSAVED_CONFIRM_ACCEPT_LABEL = "Sair sem salvar";
export const FECHAMENTO_UNSAVED_CONFIRM_CANCEL_LABEL = "Continuar preenchendo";

export const NENHUM_CLIENTE_INFORMADO_MESSAGE =
  "Registre pelo menos um cliente antes de concluir o atendimento.";
export const ATENDIMENTO_NAO_ESTA_FINALIZANDO_MESSAGE = "Este atendimento não está em finalização.";
export const MOTIVO_OBRIGATORIO_MESSAGE = "Selecione um motivo para cada cliente.";
export const MOTIVO_INVALIDO_MESSAGE =
  "Motivo inválido ou inativo. Atualize a página e tente novamente.";
export const DETALHE_OBRIGATORIO_MESSAGE = "Adicione detalhes para o motivo selecionado.";

export const FUNCIONARIO_ALVO_INVALIDO_MESSAGE =
  "Não foi possível identificar esse colaborador. Atualize a página e tente novamente.";
export const FUNCIONARIO_ALVO_INDISPONIVEL_MESSAGE =
  "Esse colaborador não está mais disponível na Lista da Vez.";
export const SEM_PERMISSAO_CANCELAR_MESSAGE =
  "Você não tem permissão para cancelar este atendimento.";

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
