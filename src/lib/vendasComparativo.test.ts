import { describe, expect, it } from "vitest";

import {
  calcularVariacao,
  descricaoJanela,
  formatDataComSemana,
  formatDataCurta,
  formatVariacao,
  getComparativoAtualizadoEm,
  isComparativoVazio,
  isVendasVisao,
  montarLinhasComparativo,
  parseVendasComparativoJanela,
  tomVariacao,
  type VendasComparativoJanela,
} from "@/lib/vendasComparativo";

function janela(
  anosAtras: number,
  overrides: Partial<VendasComparativoJanela> = {},
): VendasComparativoJanela {
  const ano = 2026 - anosAtras;
  return {
    anos_atras: anosAtras,
    data_inicio: `${ano}-11-01`,
    data_fim: `${ano}-11-19`,
    venda_liquida: 1000,
    tickets: 10,
    pecas_liquidas: 15,
    ticket_medio: 100,
    pa: 1.5,
    pm: 66.67,
    atualizado_em: null,
    ...overrides,
  };
}

// Server order is irrelevant: the client orders by anos_atras (oldest first).
const QUATRO_ANOS = [janela(0), janela(1), janela(2), janela(3)];

describe("calcularVariacao", () => {
  it("is the relative change against the previous row", () => {
    expect(calcularVariacao(110, 100)).toBeCloseTo(0.1);
    expect(calcularVariacao(75, 100)).toBeCloseTo(-0.25);
    expect(calcularVariacao(100, 100)).toBe(0);
  });

  it("has no percentage without a usable baseline (zero, negative or missing)", () => {
    expect(calcularVariacao(50, 0)).toBeNull();
    expect(calcularVariacao(0, 0)).toBeNull();
    expect(calcularVariacao(50, -10)).toBeNull();
    expect(calcularVariacao(50, null)).toBeNull();
    expect(calcularVariacao(null, 50)).toBeNull();
  });

  it("is -100% when the current value dropped to zero", () => {
    expect(calcularVariacao(0, 200)).toBe(-1);
  });
});

describe("formatVariacao / tomVariacao", () => {
  it("formats signed pt-BR percentages with one decimal", () => {
    expect(formatVariacao(0.1234)).toBe("+12,3%");
    expect(formatVariacao(-0.041)).toBe("−4,1%");
    expect(formatVariacao(1.5)).toBe("+150,0%");
  });

  it("shows a dash without a baseline and a plain 0,0% when flat", () => {
    expect(formatVariacao(null)).toBe("—");
    expect(formatVariacao(0)).toBe("0,0%");
    expect(formatVariacao(0.0004)).toBe("0,0%");
  });

  it("colours only visible gains/losses", () => {
    expect(tomVariacao(0.05)).toBe("positivo");
    expect(tomVariacao(-0.05)).toBe("negativo");
    expect(tomVariacao(0)).toBe("neutro");
    expect(tomVariacao(0.0004)).toBe("neutro");
    expect(tomVariacao(null)).toBe("neutro");
  });
});

describe("montarLinhasComparativo", () => {
  it("orders four years oldest → newest regardless of server order", () => {
    const linhas = montarLinhasComparativo("ano", QUATRO_ANOS);
    expect(linhas.map((l) => l.janela.anos_atras)).toEqual([3, 2, 1, 0]);
    expect(linhas.map((l) => l.rotulo)).toEqual(["2023", "2024", "2025", "2026"]);
    expect(linhas.map((l) => l.atual)).toEqual([false, false, false, true]);
  });

  it("gives the oldest row no %Δ baseline", () => {
    const [maisAntiga] = montarLinhasComparativo("ano", QUATRO_ANOS);
    expect(Object.values(maisAntiga.variacoes).every((v) => v === null)).toBe(true);
  });

  it("compares each row only against the immediately previous row", () => {
    const linhas = montarLinhasComparativo("ano", [
      janela(3, { venda_liquida: 1000 }),
      janela(2, { venda_liquida: 1100 }),
      janela(1, { venda_liquida: 990 }),
      janela(0, { venda_liquida: 1485 }),
    ]);
    expect(linhas.map((l) => l.variacoes.venda)).toEqual([
      null,
      expect.closeTo(0.1),
      expect.closeTo(-0.1),
      expect.closeTo(0.5),
    ]);
  });

  it("compares every metric, using the server-derived ratios as-is", () => {
    const [, atual] = montarLinhasComparativo("ano", [
      janela(1, {
        venda_liquida: 1000,
        pecas_liquidas: 20,
        tickets: 10,
        pa: 2,
        ticket_medio: 100,
        pm: 50,
      }),
      janela(0, {
        venda_liquida: 1200,
        pecas_liquidas: 18,
        tickets: 12,
        pa: 1.5,
        ticket_medio: 100,
        pm: 66.66,
      }),
    ]);
    expect(atual.variacoes.venda).toBeCloseTo(0.2);
    expect(atual.variacoes.pecas).toBeCloseTo(-0.1);
    expect(atual.variacoes.tickets).toBeCloseTo(0.2);
    // PA 1.5 vs 2 → -25% (from the aggregated 18/12 vs 20/10, not a mean of days)
    expect(atual.variacoes.pa).toBeCloseTo(-0.25);
    expect(atual.variacoes.ticketMedio).toBeCloseTo(0);
    expect(atual.variacoes.pm).toBeCloseTo(0.3332);
  });

  it("handles zero denominators and null ratios (days without sales)", () => {
    const [, atual] = montarLinhasComparativo("hoje", [
      janela(1, {
        venda_liquida: 0,
        tickets: 0,
        pecas_liquidas: 0,
        ticket_medio: null,
        pa: null,
        pm: null,
      }),
      janela(0, {
        venda_liquida: 500,
        tickets: 3,
        pecas_liquidas: 4,
        ticket_medio: 166.67,
        pa: 1.33,
        pm: 125,
      }),
    ]);
    expect(Object.values(atual.variacoes).every((v) => v === null)).toBe(true);
  });

  it("labels each period compactly", () => {
    const mes = montarLinhasComparativo("mes", QUATRO_ANOS).map((l) => l.rotulo);
    expect(mes).toEqual(["Nov/2023", "Nov/2024", "Nov/2025", "Nov/2026"]);

    const hoje = montarLinhasComparativo("hoje", QUATRO_ANOS).map((l) => l.rotulo);
    expect(hoje).toEqual(["2023", "2024", "2025", "2026"]);

    const doze = montarLinhasComparativo("ultimos_12_meses", QUATRO_ANOS).map((l) => l.rotulo);
    expect(doze).toEqual(["até 19/11/23", "até 19/11/24", "até 19/11/25", "até 19/11/26"]);
  });

  it("keeps the year label of a Hoje row whose weekday date falls in the previous December", () => {
    const linhas = montarLinhasComparativo("hoje", [
      janela(1, { data_inicio: "2025-01-02", data_fim: "2025-01-02" }),
      janela(0, { data_inicio: "2026-01-01", data_fim: "2026-01-01" }),
      janela(3, { data_inicio: "2022-12-29", data_fim: "2022-12-29" }),
      janela(2, { data_inicio: "2024-01-04", data_fim: "2024-01-04" }),
    ]);
    expect(linhas.map((l) => l.rotulo)).toEqual(["2023", "2024", "2025", "2026"]);
  });
});

describe("window descriptions and dates", () => {
  it("formats ISO dates without timezone drift", () => {
    expect(formatDataCurta("2026-11-19")).toBe("19/11/2026");
    expect(formatDataCurta("2024-02-29")).toBe("29/02/2024");
    expect(formatDataComSemana("2026-11-19")).toBe("qui 19/11/2026");
    expect(formatDataComSemana("2025-11-20")).toBe("qui 20/11/2025");
    expect(formatDataComSemana("2022-12-29")).toBe("qui 29/12/2022");
  });

  it("describes a Hoje window as a weekday date and the others as a range", () => {
    const j = janela(0, { data_inicio: "2026-11-19", data_fim: "2026-11-19" });
    expect(descricaoJanela("hoje", j)).toBe("qui 19/11/2026");
    expect(descricaoJanela("mes", janela(0))).toBe("01/11/2026 – 19/11/2026");
  });
});

describe("parseVendasComparativoJanela", () => {
  const row = { ...janela(0), venda_liquida: "1234.50" };

  it("accepts numeric text from PostgREST and null ratios", () => {
    expect(parseVendasComparativoJanela(row)?.venda_liquida).toBe(1234.5);
    expect(
      parseVendasComparativoJanela({ ...row, pa: null, pm: null, ticket_medio: null })?.pa,
    ).toBeNull();
  });

  it("rejects malformed rows", () => {
    expect(parseVendasComparativoJanela(null)).toBeNull();
    expect(parseVendasComparativoJanela({ ...row, data_fim: "19/11/2026" })).toBeNull();
    expect(parseVendasComparativoJanela({ ...row, tickets: "x" })).toBeNull();
    expect(parseVendasComparativoJanela({ ...row, anos_atras: 1.5 })).toBeNull();
  });
});

describe("misc helpers", () => {
  it("detects an empty comparison", () => {
    expect(isComparativoVazio([janela(0, { venda_liquida: 0, tickets: 0 })])).toBe(true);
    expect(isComparativoVazio([janela(0, { venda_liquida: 0, tickets: 0 }), janela(1)])).toBe(
      false,
    );
  });

  it("picks the latest freshness timestamp", () => {
    expect(
      getComparativoAtualizadoEm([
        janela(1, { atualizado_em: "2025-11-19T20:00:00Z" }),
        janela(0, { atualizado_em: "2026-11-19T15:00:00Z" }),
      ]),
    ).toBe("2026-11-19T15:00:00Z");
    expect(getComparativoAtualizadoEm([janela(0)])).toBeNull();
  });

  it("validates the view keys", () => {
    expect(isVendasVisao("equipe")).toBe(true);
    expect(isVendasVisao("comparativo")).toBe(true);
    expect(isVendasVisao("anos")).toBe(false);
  });
});
