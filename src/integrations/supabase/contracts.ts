export interface Employee {
  id: string;
  apelido: string;
  nome: string;
  cargo: string;
}

export interface VerifyPinSuccess {
  success: true;
  funcionario_id: string;
  nome: string;
  cargo: string;
}

export interface VerifyPinFailure {
  success: false;
}

export type VerifyPinResult = VerifyPinSuccess | VerifyPinFailure;

export function isVerifyPinSuccess(value: unknown): value is VerifyPinSuccess {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.success === true &&
    typeof candidate.funcionario_id === "string" &&
    candidate.funcionario_id.length > 0
  );
}
