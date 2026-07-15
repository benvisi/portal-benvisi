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
export const SEARCH_PLACEHOLDER = "Buscar por apelido...";
