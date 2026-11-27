// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstoqueBuscaField } from "@/components/estoque/EstoqueBuscaField";
import type { EstoqueProdutoBusca } from "@/integrations/supabase/contracts";

afterEach(cleanup);

function sugestao(produto: string): EstoqueProdutoBusca {
  return { produto, desc_produto: "Polo", cores_disponiveis: 2 } as EstoqueProdutoBusca;
}

function montar({
  sugestoes = [] as EstoqueProdutoBusca[],
  comCodigo = true,
  onEscanear,
}: { sugestoes?: EstoqueProdutoBusca[]; comCodigo?: boolean; onEscanear?: () => void } = {}) {
  const onSelect = vi.fn();
  const onCodigoBarra = vi.fn();
  function Harness() {
    const [valor, setValor] = useState("");
    return createElement(EstoqueBuscaField, {
      value: valor,
      onChange: setValor,
      onSelect,
      onCodigoBarra: comCodigo ? onCodigoBarra : undefined,
      onEscanear,
      suggestions: sugestoes,
      isLoading: false,
      isError: false,
      hasQueried: true,
    });
  }
  render(createElement(Harness));
  const input = screen.getByRole("textbox");
  const digitarEEnter = (texto: string) => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: texto } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  return { input, onSelect, onCodigoBarra, digitarEEnter };
}

describe("EstoqueBuscaField barcode entry", () => {
  it("USB scanner: digits + Enter resolve as a barcode before suggestions load", () => {
    const { onSelect, onCodigoBarra, digitarEEnter } = montar();
    digitarEEnter("0012345678905\r");
    expect(onCodigoBarra).toHaveBeenCalledWith("0012345678905", null);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps focus and selects the code for the next scan (desktop)", () => {
    const { input, digitarEEnter } = montar();
    input.focus();
    digitarEEnter("3614037654321");
    expect(document.activeElement).toBe(input);
  });

  it("short numbers stay an ordinary search (top suggestion)", () => {
    const { onSelect, onCodigoBarra, digitarEEnter } = montar({
      sugestoes: [sugestao("L1212")],
    });
    digitarEEnter("1212");
    expect(onCodigoBarra).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("L1212");
  });

  it("an exact reference always wins over barcode resolution", () => {
    const { onSelect, onCodigoBarra, digitarEEnter } = montar({
      sugestoes: [sugestao("PH4012001P2X")],
    });
    digitarEEnter("ph4012001p2x");
    expect(onCodigoBarra).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("PH4012001P2X");
  });

  it("text searches are unchanged", () => {
    const { onSelect, onCodigoBarra, digitarEEnter } = montar({
      sugestoes: [sugestao("PH4012")],
    });
    digitarEEnter("polo azul marinho");
    expect(onCodigoBarra).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("PH4012");
  });

  it("a long alphanumeric token tries the barcode with the old Enter target as fallback", () => {
    const { onCodigoBarra, digitarEEnter } = montar({ sugestoes: [sugestao("PH4012")] });
    digitarEEnter("PH4012001P2X");
    expect(onCodigoBarra).toHaveBeenCalledWith("PH4012001P2X", "PH4012");
  });

  it("without a barcode handler the previous behaviour is untouched", () => {
    const { onSelect, digitarEEnter } = montar({ comCodigo: false });
    digitarEEnter("0012345678905");
    expect(onSelect).toHaveBeenCalledWith("0012345678905");
  });

  it("renders the camera button only when a scan handler is given", () => {
    const onEscanear = vi.fn();
    montar({ onEscanear });
    fireEvent.click(screen.getByRole("button", { name: "Escanear código de barras" }));
    expect(onEscanear).toHaveBeenCalledOnce();
    cleanup();
    montar();
    expect(screen.queryByRole("button", { name: "Escanear código de barras" })).toBeNull();
  });
});
