import { describe, expect, it } from "vitest";

import {
  agruparAtendimentoResumoHoje,
  calcularConversaoPercentual,
  formatAtendimentoResumoHora,
} from "@/lib/atendimentoResumoHoje";
import type { AtendimentoResumoHojeLinha } from "@/integrations/supabase/contracts";

function linha(overrides: Partial<AtendimentoResumoHojeLinha>): AtendimentoResumoHojeLinha {
  return {
    funcionario_id: "vendedor-1",
    funcionario_nome: "Ana",
    id_atendimento: null,
    iniciado_em: null,
    concluido_em: null,
    id_atendimento_cliente: null,
    categoria: null,
    motivo_rotulo: null,
    detalhe: null,
    ...overrides,
  };
}

describe("formatAtendimentoResumoHora", () => {
  it("formats an ISO instant as Manaus HH:mm", () => {
    // 14:18 UTC = 10:18 in America/Manaus (UTC-4).
    expect(formatAtendimentoResumoHora("2026-09-25T14:18:00Z")).toBe("10:18");
  });
});

describe("calcularConversaoPercentual", () => {
  it("rounds to the nearest whole percent", () => {
    expect(calcularConversaoPercentual(6, 10)).toBe(60);
    expect(calcularConversaoPercentual(1, 3)).toBe(33);
    expect(calcularConversaoPercentual(2, 3)).toBe(67);
  });

  it("returns null when there are no outcomes to divide by", () => {
    expect(calcularConversaoPercentual(0, 0)).toBeNull();
  });
});

describe("agruparAtendimentoResumoHoje", () => {
  it("returns zero totals and no vendedores for an empty payload", () => {
    const resumo = agruparAtendimentoResumoHoje([]);
    expect(resumo.totalAtendimentos).toBe(0);
    expect(resumo.totalConvertidos).toBe(0);
    expect(resumo.totalOutcomes).toBe(0);
    expect(resumo.porVendedor).toEqual([]);
    expect(resumo.porAtendimento).toEqual([]);
  });

  it("keeps a vendedor with zero concluded atendimentos today", () => {
    const resumo = agruparAtendimentoResumoHoje([
      linha({ funcionario_id: "v1", funcionario_nome: "Ana" }),
    ]);
    expect(resumo.porVendedor).toHaveLength(1);
    expect(resumo.porVendedor[0]).toMatchObject({
      funcionarioId: "v1",
      nome: "Ana",
      atendimentos: [],
      totalAtendimentos: 0,
      totalConvertidos: 0,
      totalOutcomes: 0,
    });
    expect(resumo.totalAtendimentos).toBe(0);
  });

  it("aggregates a normal single-outcome atendimento", () => {
    const resumo = agruparAtendimentoResumoHoje([
      linha({
        funcionario_id: "v1",
        funcionario_nome: "Ana",
        id_atendimento: "a1",
        iniciado_em: "2026-09-25T13:00:00Z",
        concluido_em: "2026-09-25T13:20:00Z",
        id_atendimento_cliente: "c1",
        categoria: "convertido",
        motivo_rotulo: "Comprou tênis",
        detalhe: null,
      }),
    ]);

    expect(resumo.totalAtendimentos).toBe(1);
    expect(resumo.totalConvertidos).toBe(1);
    expect(resumo.totalOutcomes).toBe(1);
    expect(resumo.porVendedor[0].atendimentos[0].outcomes).toEqual([
      { id: "c1", categoria: "convertido", motivoRotulo: "Comprou tênis", detalhe: null },
    ]);
  });

  it("groups a multi-outcome atendimento with mixed conversion results under one entry", () => {
    const rows = [
      linha({
        funcionario_id: "v1",
        funcionario_nome: "Ana",
        id_atendimento: "a1",
        iniciado_em: "2026-09-25T13:00:00Z",
        concluido_em: "2026-09-25T13:40:00Z",
        id_atendimento_cliente: "c1",
        categoria: "convertido",
        motivo_rotulo: "Comprou tênis",
        detalhe: null,
      }),
      linha({
        funcionario_id: "v1",
        funcionario_nome: "Ana",
        id_atendimento: "a1",
        iniciado_em: "2026-09-25T13:00:00Z",
        concluido_em: "2026-09-25T13:40:00Z",
        id_atendimento_cliente: "c2",
        categoria: "nao_convertido",
        motivo_rotulo: "Sem o tamanho",
        detalhe: "Precisa do 42",
      }),
    ];

    const resumo = agruparAtendimentoResumoHoje(rows);

    // Same atendimento — one entry, not two.
    expect(resumo.totalAtendimentos).toBe(1);
    expect(resumo.totalOutcomes).toBe(2);
    expect(resumo.totalConvertidos).toBe(1);
    expect(resumo.porVendedor[0].atendimentos).toHaveLength(1);
    expect(resumo.porVendedor[0].atendimentos[0].outcomes).toHaveLength(2);
    expect(resumo.porAtendimento).toHaveLength(1);
    expect(resumo.porAtendimento[0].outcomes.map((o) => o.categoria)).toEqual([
      "convertido",
      "nao_convertido",
    ]);
  });

  it("sorts Por atendimento by iniciado_em desc across every vendedor", () => {
    const rows = [
      linha({
        funcionario_id: "v1",
        funcionario_nome: "Ana",
        id_atendimento: "early",
        iniciado_em: "2026-09-25T12:00:00Z",
        id_atendimento_cliente: "c1",
        categoria: "convertido",
        motivo_rotulo: "Comprou",
      }),
      linha({
        funcionario_id: "v2",
        funcionario_nome: "Bruno",
        id_atendimento: "late",
        iniciado_em: "2026-09-25T15:00:00Z",
        id_atendimento_cliente: "c2",
        categoria: "nao_convertido",
        motivo_rotulo: "Só olhando",
      }),
    ];

    const resumo = agruparAtendimentoResumoHoje(rows);
    expect(resumo.porAtendimento.map((item) => item.idAtendimento)).toEqual(["late", "early"]);
    expect(resumo.porAtendimento[0].funcionarioNome).toBe("Bruno");
  });
});
