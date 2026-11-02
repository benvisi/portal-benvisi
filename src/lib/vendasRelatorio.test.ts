import { describe, expect, it } from "vitest";

import { RELATORIO_VENDAS_COLUMNS } from "@/config/constants";
import {
  formatBrl,
  formatBrlWhole,
  formatPa,
  formatVendasAtualizadoEm,
  organizarLinhasVendas,
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
