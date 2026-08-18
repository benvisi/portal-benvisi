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
