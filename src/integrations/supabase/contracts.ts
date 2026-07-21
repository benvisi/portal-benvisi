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
