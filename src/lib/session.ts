import { LOCALE_PT_BR, MANAUS_TIMEZONE, SESSION_STORAGE_KEY } from "@/config/constants";

export interface AuthSessionData {
  funcionario_id: string;
  /** Full/legal name. */
  nome: string;
  /** Employee-facing informal identity — what the UI greets/labels the user with. */
  apelido: string;
  cargo: string;
  timestamp_login: string;
  session_token: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function isAuthSessionData(value: unknown): value is AuthSessionData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.funcionario_id === "string" &&
    candidate.funcionario_id.length > 0 &&
    typeof candidate.nome === "string" &&
    candidate.nome.length > 0 &&
    typeof candidate.apelido === "string" &&
    candidate.apelido.length > 0 &&
    typeof candidate.cargo === "string" &&
    candidate.cargo.length > 0 &&
    typeof candidate.timestamp_login === "string" &&
    candidate.timestamp_login.length > 0 &&
    typeof candidate.session_token === "string" &&
    candidate.session_token.length > 0
  );
}

export const AuthSession = {
  get(): AuthSessionData | null {
    if (!isBrowser()) return null;
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isAuthSessionData(parsed)) return parsed;
    } catch {
      // fall through to clear
    }
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  },

  save(data: AuthSessionData): void {
    if (!isBrowser()) return;
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
  },

  clear(): void {
    if (!isBrowser()) return;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  },

  isAuthenticated(): boolean {
    return this.get() !== null;
  },
};

export function formatManaus(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
