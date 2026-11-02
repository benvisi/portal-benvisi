import { describe, expect, it } from "vitest";

import { RELATORIO_VENDAS_COLUMNS } from "@/config/constants";
import {
  formatBrl,
  formatBrlWhole,
  formatPa,
  formatVendasAtualizadoEm,
  getVendasAtualizadoEm,
  getVendasLinhaLabel,
  isRelatorioVendasVazio,
  organizarLinhasVendas,
  parseVendasMetricasLinha,
  type VendasMetricasLinha,
} from "@/lib/vendasRelatorio";

function linha(overrides: Partial<VendasMetricasLinha>): VendasMetricasLinha {
  return {
    funcionario_id: "x",
    vendedor_nome: "X",
    eh_outros: false,
    eh_total: false,
    venda_liquida: 0,
    tickets: 0,
    pecas_brutas: 0,
    pecas_troca: 0,
    pecas_liquidas: 0,
    ticket_medio: null,
    pa: null,
    pm: null,
    atualizado_em: "2026-10-02T17:55:00Z",
    ...overrides,
  };
}

describe("organizarLinhasVendas", () => {
  it("sorts salespeople by venda_liquida desc and separates Outros/Total", () => {
    const { vendedores, outros, total } = organizarLinhasVendas([
      linha({ eh_total: true, venda_liquida: 100 }),
      linha({ vendedor_nome: "A", venda_liquida: 10 }),
      linha({ eh_outros: true, venda_liquida: 5 }),
      linha({ vendedor_nome: "B", venda_liquida: 85 }),
    ]);
    expect(vendedores.map((v) => v.vendedor_nome)).toEqual(["B", "A"]);
    expect(outros?.venda_liquida).toBe(5);
    expect(total?.venda_liquida).toBe(100);
  });
});

describe("formatters", () => {
  it("formats null as an em dash and PA with one decimal", () => {
    expect(formatBrl(null)).toBe("—");
    expect(formatPa(1.846)).toBe("1,8");
  });

  it("formats BRL with no space after R$", () => {
    expect(formatBrlWhole(71542.35)).toBe("R$71.542");
    expect(formatBrlWhole(928)).toBe("R$928");
    expect(formatBrl(851.7)).toBe("R$851,70");
  });

  it("formats freshness with date and time in Manaus time", () => {
    expect(formatVendasAtualizadoEm("2026-10-02T17:55:00Z")).toBe(
      "Atualizado em 02/10/2026 às 13:55",
    );
  });
});

const RPC_ROW = {
  funcionario_id: "9579c710-74d7-415f-9503-9eb03a39c979",
  vendedor_nome: "Vitor",
  eh_outros: false,
  eh_total: false,
  venda_liquida: 159,
  tickets: 3,
  pecas_brutas: 3,
  pecas_troca: 2,
  pecas_liquidas: 1,
  ticket_medio: 53,
  pa: 0.3333,
  pm: 159,
  atualizado_em: "2026-11-02T02:57:21.377735+00:00",
};

describe("parseVendasMetricasLinha", () => {
  it("accepts a valid RPC row", () => {
    expect(parseVendasMetricasLinha(RPC_ROW)?.vendedor_nome).toBe("Vitor");
  });

  it("accepts numeric strings and null ratios", () => {
    const parsed = parseVendasMetricasLinha({
      ...RPC_ROW,
      venda_liquida: "159.00",
      ticket_medio: null,
    });
    expect(parsed?.venda_liquida).toBe(159);
    expect(parsed?.ticket_medio).toBeNull();
  });

  it("rejects malformed rows", () => {
    expect(parseVendasMetricasLinha(null)).toBeNull();
    expect(parseVendasMetricasLinha({ ...RPC_ROW, venda_liquida: "abc" })).toBeNull();
    expect(parseVendasMetricasLinha({ ...RPC_ROW, eh_total: "no" })).toBeNull();
  });
});

describe("getVendasLinhaLabel", () => {
  it("shows the RPC Total da loja row as Total", () => {
    expect(getVendasLinhaLabel(linha({ eh_total: true, vendedor_nome: "Total da loja" }))).toBe(
      "Total",
    );
  });

  it("shows Outros and normal names", () => {
    expect(getVendasLinhaLabel(linha({ eh_outros: true, vendedor_nome: "Outros" }))).toBe("Outros");
    expect(getVendasLinhaLabel(linha({ vendedor_nome: "Graça" }))).toBe("Graça");
  });
});

describe("freshness and empty state", () => {
  it("uses the latest non-null atualizado_em", () => {
    expect(
      getVendasAtualizadoEm([
        linha({ atualizado_em: "2026-11-01T10:00:00Z" }),
        linha({ atualizado_em: null }),
        linha({ atualizado_em: "2026-11-02T02:57:00Z" }),
      ]),
    ).toBe("2026-11-02T02:57:00Z");
    expect(getVendasAtualizadoEm([linha({ atualizado_em: null })])).toBeNull();
  });

  it("is empty only with no sellers, no Outros and a zero Total", () => {
    const zeroTotal = linha({ eh_total: true, vendedor_nome: "Total da loja" });
    expect(isRelatorioVendasVazio([])).toBe(true);
    expect(isRelatorioVendasVazio([zeroTotal])).toBe(true);
    expect(isRelatorioVendasVazio([linha({ venda_liquida: 10, tickets: 1 }), zeroTotal])).toBe(
      false,
    );
    expect(isRelatorioVendasVazio([{ ...zeroTotal, venda_liquida: 5, tickets: 1 }])).toBe(false);
  });
});

describe("column order", () => {
  it("matches the business reporting order", () => {
    expect([...RELATORIO_VENDAS_COLUMNS]).toEqual([
      "Vendedor",
      "R$",
      "Peças",
      "Trocas",
      "Peças Líq.",
      "Tickets",
      "PA",
      "Ticket Méd.",
      "PM",
    ]);
  });
});
