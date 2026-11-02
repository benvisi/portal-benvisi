import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VendasPeriodoSeletor } from "@/components/vendas/VendasPeriodoSeletor";
import { RELATORIO_VENDAS_PERIODOS } from "@/config/constants";
import { VENDAS_PERIODO_PADRAO, type VendasPeriodo } from "@/lib/vendasRelatorio";

function render(value: VendasPeriodo) {
  return renderToStaticMarkup(createElement(VendasPeriodoSeletor, { value, onChange: () => {} }));
}

describe("VendasPeriodoSeletor", () => {
  it("defaults to Hoje", () => {
    expect(VENDAS_PERIODO_PADRAO).toBe("hoje");
  });

  it("shows the four periods in order with the exact employee-facing wording", () => {
    const html = render("hoje");
    const labels = ["Hoje", "Mês", "Ano", "Últimos 12 meses"];
    const positions = labels.map((label) => html.indexOf(`>${label}<`));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(RELATORIO_VENDAS_PERIODOS.map((p) => p.label)).toEqual(labels);
  });

  it("marks only the selected period as active", () => {
    for (const { value, label } of RELATORIO_VENDAS_PERIODOS) {
      const html = render(value);
      expect(html.match(/data-state="active"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`data-state="active"[^>]*>${label}<`));
    }
  });

  it("reports each selected period through onChange, ignoring unknown values", () => {
    const onChange = vi.fn();
    const root = VendasPeriodoSeletor({ value: "hoje", onChange }) as ReactElement<{
      onValueChange: (value: string) => void;
    }>;

    for (const { value } of RELATORIO_VENDAS_PERIODOS) root.props.onValueChange(value);
    root.props.onValueChange("semana");

    expect(onChange.mock.calls.map(([periodo]) => periodo)).toEqual([
      "hoje",
      "mes",
      "ano",
      "ultimos_12_meses",
    ]);
  });
});
