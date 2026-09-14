// Pure classification of one raw Escala schedule cell value, mirroring the
// CASE logic in escala_processar_importacao
// (supabase/migrations/20260914_004_add_escala_processar_importacao_rpc.sql).
//
// This is UX-only: the RPC is the sole source of truth and independently
// re-derives everything from the raw string it is sent, never trusting this
// client-side classification. This function exists so the admin preview can
// give instant feedback and so this deterministic rule set has real,
// fast unit test coverage — see escalaValorEscala.test.ts. If the SQL CASE
// expression above ever changes, update this to match.
//
// MANHÃ/TARDE are deliberately NOT resolved to concrete hours here — that
// requires the store's actual operating hours for the date (loja_horario_do_dia),
// a business rule that lives in the database, not hard-coded client-side.
export type EscalaValorClassificado =
  | { tipo: "folga" }
  | { tipo: "ferias" }
  | { tipo: "trabalho"; horaInicio: string; horaFim: string }
  | { tipo: "turno_abstrato"; turno: "manha" | "tarde" }
  | { tipo: "invalido"; motivo: "horario_incoerente" | "valor_nao_reconhecido" };

const HORARIO_REGEX = /^([0-9]{1,2}):([0-9]{2})-([0-9]{1,2}):([0-9]{2})$/;

function paraMinutos(hora: number, minuto: number): number {
  return hora * 60 + minuto;
}

export function classificarValorEscala(valorBruto: string): EscalaValorClassificado {
  const valor = valorBruto.trim().toUpperCase();

  if (valor === "FOLGA") return { tipo: "folga" };
  if (valor === "FÉRIAS" || valor === "FERIAS") return { tipo: "ferias" };
  if (valor === "MANHÃ" || valor === "MANHA") return { tipo: "turno_abstrato", turno: "manha" };
  if (valor === "TARDE") return { tipo: "turno_abstrato", turno: "tarde" };

  const match = valor.match(HORARIO_REGEX);
  if (match) {
    const [, hIni, mIni, hFim, mFim] = match;
    const inicioMin = paraMinutos(Number(hIni), Number(mIni));
    const fimMin = paraMinutos(Number(hFim), Number(mFim));
    if (fimMin <= inicioMin) {
      return { tipo: "invalido", motivo: "horario_incoerente" };
    }
    return {
      tipo: "trabalho",
      horaInicio: `${hIni.padStart(2, "0")}:${mIni}`,
      horaFim: `${hFim.padStart(2, "0")}:${mFim}`,
    };
  }

  return { tipo: "invalido", motivo: "valor_nao_reconhecido" };
}
