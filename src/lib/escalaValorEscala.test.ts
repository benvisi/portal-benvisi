import { describe, expect, it } from "vitest";

import { classificarValorEscala } from "@/lib/escalaValorEscala";

describe("classificarValorEscala", () => {
  it("classifies FOLGA", () => {
    expect(classificarValorEscala("FOLGA")).toEqual({ tipo: "folga" });
    expect(classificarValorEscala(" folga ")).toEqual({ tipo: "folga" });
  });

  it("classifies FÉRIAS (with or without the accent)", () => {
    expect(classificarValorEscala("FÉRIAS")).toEqual({ tipo: "ferias" });
    expect(classificarValorEscala("FERIAS")).toEqual({ tipo: "ferias" });
  });

  it("classifies an explicit hour range", () => {
    expect(classificarValorEscala("10:00-16:00")).toEqual({
      tipo: "trabalho",
      horaInicio: "10:00",
      horaFim: "16:00",
    });
  });

  it("accepts a valid extended-hours range without any ordinary-mall-hours limit", () => {
    expect(classificarValorEscala("10:00-23:00")).toEqual({
      tipo: "trabalho",
      horaInicio: "10:00",
      horaFim: "23:00",
    });
    expect(classificarValorEscala("12:00-23:00")).toEqual({
      tipo: "trabalho",
      horaInicio: "12:00",
      horaFim: "23:00",
    });
  });

  it("rejects a malformed/incoherent clock range (end before or equal to start)", () => {
    expect(classificarValorEscala("18:00-10:00")).toEqual({
      tipo: "invalido",
      motivo: "horario_incoerente",
    });
    expect(classificarValorEscala("10:00-10:00")).toEqual({
      tipo: "invalido",
      motivo: "horario_incoerente",
    });
  });

  it("classifies MANHÃ/TARDE as abstract turnos, never resolving hours itself", () => {
    expect(classificarValorEscala("MANHÃ")).toEqual({ tipo: "turno_abstrato", turno: "manha" });
    expect(classificarValorEscala("MANHA")).toEqual({ tipo: "turno_abstrato", turno: "manha" });
    expect(classificarValorEscala("TARDE")).toEqual({ tipo: "turno_abstrato", turno: "tarde" });
  });

  it("flags an unrecognized value", () => {
    expect(classificarValorEscala("ALGO ESTRANHO")).toEqual({
      tipo: "invalido",
      motivo: "valor_nao_reconhecido",
    });
  });
});
