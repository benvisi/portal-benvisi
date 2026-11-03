import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VendasRelatorioConteudo } from "@/components/vendas/VendasRelatorioConteudo";
import {
  RELATORIO_VENDAS_COLUMNS,
  RELATORIO_VENDAS_ERRO_MESSAGE,
  RELATORIO_VENDAS_VAZIO_MESSAGE,
} from "@/config/constants";
import type { VendasMetricasLinha } from "@/lib/vendasRelatorio";

function linha(overrides: Partial<VendasMetricasLinha>): VendasMetricasLinha {
  return {
    funcionario_id: null,
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
    atualizado_em: "2026-11-02T02:57:21Z",
    ...overrides,
  };
}

const RENAN = linha({
  funcionario_id: "r",
  vendedor_nome: "Renan",
  venda_liquida: 9789.09,
  tickets: 11,
  pecas_brutas: 16,
  pecas_troca: 2,
  pecas_liquidas: 14,
  ticket_medio: 889.917,
  pa: 1.2727,
  pm: 699.2207,
});
const TOTAL = linha({
  vendedor_nome: "Total da loja",
  eh_total: true,
  venda_liquida: 16646.44,
  tickets: 22,
  pecas_brutas: 31,
  pecas_troca: 5,
  pecas_liquidas: 26,
  ticket_medio: 756.66,
  pa: 1.18,
  pm: 640.25,
});
const OUTROS = linha({
  vendedor_nome: "Outros",
  eh_outros: true,
  venda_liquida: 100,
  tickets: 1,
  pecas_brutas: 1,
  pecas_liquidas: 1,
  ticket_medio: 100,
  pa: 1,
  pm: 100,
});

function render(props: Partial<Parameters<typeof VendasRelatorioConteudo>[0]>) {
  return renderToStaticMarkup(
    createElement(VendasRelatorioConteudo, {
      isLoading: false,
      isError: false,
      linhas: undefined,
      onRetry: () => {},
      ...props,
    }),
  );
}

describe("VendasRelatorioConteudo", () => {
  it("renders the table with approved columns, formatting and the Total label", () => {
    const html = render({ linhas: [TOTAL, RENAN] });
    for (const coluna of RELATORIO_VENDAS_COLUMNS) expect(html).toContain(coluna);
    expect(html).toContain("Renan");
    expect(html).toContain("R$9.789"); // whole reais, no space
    expect(html).toContain("R$890"); // Ticket Méd., whole reais
    expect(html).toContain("1,3"); // PA, one decimal
    expect(html).not.toContain("Total da loja");
    expect(html).toContain(">Total<");
  });

  it("renders Outros when present and omits it when absent", () => {
    expect(render({ linhas: [RENAN, OUTROS, TOTAL] })).toContain(">Outros<");
    expect(render({ linhas: [RENAN, TOTAL] })).not.toContain("Outros");
  });

  it("renders the loading state", () => {
    const html = render({ isLoading: true });
    expect(html).toContain("Carregando");
    expect(html).not.toContain("<table");
  });

  it("renders the error state with a retry button", () => {
    const html = render({ isError: true });
    expect(html).toContain(RELATORIO_VENDAS_ERRO_MESSAGE);
    expect(html).toContain("Tentar novamente");
  });

  it("renders the empty state for a zero month", () => {
    const html = render({ linhas: [linha({ vendedor_nome: "Total da loja", eh_total: true })] });
    expect(html).toContain(RELATORIO_VENDAS_VAZIO_MESSAGE);
    expect(html).not.toContain("<table");
  });
});
