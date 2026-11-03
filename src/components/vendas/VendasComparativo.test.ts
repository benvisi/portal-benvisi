import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VendasComparativoConteudo } from "@/components/vendas/VendasComparativoConteudo";
import { VendasIncluirHojeToggle } from "@/components/vendas/VendasIncluirHojeToggle";
import { VendasVisaoSeletor } from "@/components/vendas/VendasVisaoSeletor";
import {
  RELATORIO_VENDAS_COMPARATIVO_COLUNAS,
  RELATORIO_VENDAS_ERRO_MESSAGE,
  RELATORIO_VENDAS_VAZIO_MESSAGE,
  RELATORIO_VENDAS_VISOES,
} from "@/config/constants";
import type { VendasComparativoJanela } from "@/lib/vendasComparativo";

function janela(anosAtras: number, venda: number, tickets: number): VendasComparativoJanela {
  const ano = 2026 - anosAtras;
  return {
    anos_atras: anosAtras,
    data_inicio: `${ano}-11-01`,
    data_fim: `${ano}-11-19`,
    venda_liquida: venda,
    tickets,
    pecas_liquidas: tickets * 2,
    ticket_medio: tickets === 0 ? null : venda / tickets,
    pa: tickets === 0 ? null : 2,
    pm: tickets === 0 ? null : venda / (tickets * 2),
    atualizado_em: null,
  };
}

const QUATRO_ANOS = [
  janela(3, 100000, 100),
  janela(2, 120000, 110),
  janela(1, 90000, 100),
  janela(0, 99000, 90),
];

function renderConteudo(props: Partial<Parameters<typeof VendasComparativoConteudo>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(VendasComparativoConteudo, {
      periodo: "mes",
      isLoading: false,
      isError: false,
      janelas: QUATRO_ANOS,
      onRetry: () => {},
      ...props,
    }),
  );
}

describe("Equipe / Comparativo switching", () => {
  it("shows both views with Equipe first and marks only the active one", () => {
    expect(RELATORIO_VENDAS_VISOES.map((v) => v.label)).toEqual(["Equipe", "Comparativo"]);
    for (const { value, label } of RELATORIO_VENDAS_VISOES) {
      const html = renderToStaticMarkup(
        createElement(VendasVisaoSeletor, { value, onChange: () => {} }),
      );
      expect(html.match(/data-state="active"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`data-state="active"[^>]*>${label}<`));
    }
  });

  it("styles the tabs as worksheet tabs under a green rule, filled green when active", () => {
    const html = renderToStaticMarkup(
      createElement(VendasVisaoSeletor, { value: "comparativo", onChange: () => {} }),
    );
    expect(html).toContain("border-t-2 border-brand");
    expect(html).toContain("rounded-b-lg");
    expect(html).toContain("data-[state=active]:bg-brand");
  });

  it("reports the chosen view and ignores unknown values", () => {
    const onChange = vi.fn();
    const root = VendasVisaoSeletor({ value: "equipe", onChange }) as ReactElement<{
      onValueChange: (value: string) => void;
    }>;
    root.props.onValueChange("comparativo");
    root.props.onValueChange("equipe");
    root.props.onValueChange("anos");
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(["comparativo", "equipe"]);
  });
});

describe("Incluir hoje toggle", () => {
  function renderToggle(value: boolean) {
    return renderToStaticMarkup(
      createElement(VendasIncluirHojeToggle, { value, onChange: () => {} }),
    );
  }

  it("is an independent on/off switch: green with a check when included, quiet when not", () => {
    const sim = renderToggle(true);
    expect(sim).toContain("Incluir hoje");
    expect(sim).toContain('role="switch"');
    expect(sim).toContain('aria-checked="true"');
    expect(sim).toContain("bg-brand");
    expect(sim).toContain("<svg");

    const nao = renderToggle(false);
    expect(nao).toContain('aria-checked="false"');
    expect(nao).not.toContain("bg-brand");
    expect(nao).not.toContain("<svg");
  });

  it("flips the boolean on click", () => {
    const onChange = vi.fn();
    const sim = VendasIncluirHojeToggle({ value: true, onChange }) as ReactElement<{
      onClick: () => void;
    }>;
    sim.props.onClick();
    const nao = VendasIncluirHojeToggle({ value: false, onChange }) as ReactElement<{
      onClick: () => void;
    }>;
    nao.props.onClick();
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([false, true]);
  });
});

describe("Comparativo table", () => {
  it("shows the four year/month rows oldest → newest with the approved columns", () => {
    const html = renderConteudo();
    const labels = ["Nov/2023", "Nov/2024", "Nov/2025", "Nov/2026"];
    const positions = labels.map((l) => html.indexOf(`>${l}<`));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    for (const coluna of RELATORIO_VENDAS_COMPARATIVO_COLUNAS)
      expect(html).toContain(`>${coluna}<`);
    expect(html.match(/>%Δ</g)).toHaveLength(6);
    expect(html).not.toContain(">Trocas<");
    expect(html).not.toContain(">Peças<");
  });

  it("uses a stable Período header and year labels for Ano / Hoje", () => {
    for (const periodo of ["hoje", "mes", "ano", "ultimos_12_meses"] as const)
      expect(renderConteudo({ periodo })).toContain(">Período<");
    expect(renderConteudo({ periodo: "ano" })).toContain(">2023<");
    const hoje = renderConteudo({ periodo: "hoje" });
    expect(hoje).toContain(">2026<");
    expect(renderConteudo({ periodo: "ultimos_12_meses" })).toContain(">até 19/11/26<");
  });

  it("leaves the oldest row without %Δ and colours gains/losses of later rows", () => {
    const html = renderConteudo();
    const rows = html.split("<tr").filter((r) => r.includes("<td"));
    expect(rows).toHaveLength(4);
    // oldest row: six dashes, no coloured delta
    expect(rows[0].match(/>—</g)).toHaveLength(6);
    expect(rows[0]).not.toContain("text-emerald-700");
    expect(rows[0]).not.toContain("text-red-700");
    // 2024 grew (+20%), 2025 fell (−25%)
    expect(rows[1]).toContain("+20,0%");
    expect(rows[1]).toContain("text-emerald-700");
    expect(rows[2]).toContain("−25,0%");
    expect(rows[2]).toContain("text-red-700");
  });

  it("highlights the current (newest) row only", () => {
    expect(renderConteudo().match(/data-atual="true"/g)).toHaveLength(1);
  });

  it("scrolls horizontally with a sticky first column instead of squeezing the columns", () => {
    const html = renderConteudo();
    expect(html).toContain("overflow-x-auto");
    expect(html.match(/sticky left-0/g)).toHaveLength(5); // header + 4 rows
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("min-w-[4.5rem]");
  });

  it("does not render the compared-windows footnote or date-range lines", () => {
    const html = renderConteudo();
    expect(html).not.toContain("Períodos comparados");
    expect(html).not.toContain("01/11/2026 – 19/11/2026");
    expect(html).not.toContain("qui 19/11/2026");
    expect(renderConteudo({ periodo: "hoje" })).not.toContain("qui 19/11/2026");
  });
});

describe("Comparativo states", () => {
  it("shows the empty message when nothing sold in any window", () => {
    const html = renderConteudo({ janelas: [janela(1, 0, 0), janela(0, 0, 0)] });
    expect(html).toContain(RELATORIO_VENDAS_VAZIO_MESSAGE);
    expect(html).not.toContain("<table");
  });

  it("shows loading and error states", () => {
    expect(renderConteudo({ janelas: undefined, isLoading: true })).toContain("Carregando");
    const erro = renderConteudo({ janelas: undefined, isError: true });
    expect(erro).toContain(RELATORIO_VENDAS_ERRO_MESSAGE);
    expect(erro).toContain("Tentar novamente");
  });
});
