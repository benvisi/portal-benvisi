import {
  LOCALE_PT_BR,
  MANAUS_TIMEZONE,
  SESSION_STORAGE_KEY,
} from "@/config/constants";

export interface AuthSessionData {
  funcionario_id: string;
  nome: string;
  cargo: string;
  timestamp_login: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function isAuthSessionData(value: unknown): value is AuthSessionData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.funcionario_id === "string" &&
    typeof candidate.nome === "string" &&
    typeof candidate.cargo === "string" &&
    typeof candidate.timestamp_login === "string"
  );
}

export const AuthSession = {
  get(): AuthSessionData | null {
    const data = sessionStorage.getItem('benvisi_session');
    return data ? JSON.parse(data) : null;
  },
  
  save(data: AuthSessionData): void {
    sessionStorage.setItem('benvisi_session', JSON.stringify(data));
  },
  
  clear(): void {
    sessionStorage.removeItem('benvisi_session');
  },
  
  // The clean, future-proof API addition:
  isAuthenticated(): boolean {
    return this.get() !== null;
  }
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
