// @vitest-environment jsdom
// Mocked-RPC component tests (no network): the Supabase client is replaced by
// a fake rpc() that serves fixtures keyed by RPC name.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/hooks/useSessionErrorHandler", () => ({ useSessionErrorHandler: () => () => false }));
vi.mock("@/hooks/useProdutoImagensPublicadas", () => ({
  useProdutoImagensPublicadas: () => new Map(),
}));
vi.mock("@/components/estoque/ProdutoTermosBusca", () => ({ ProdutoTermosBusca: () => null }));

import { CodigoBarraResultadoView } from "@/components/estoque/CodigoBarraResultadoView";

afterEach(cleanup);

const SYNC = "2026-11-27T12:00:00Z";

function detalhe(cor: string, nome: string, key: number, venda: string, qtd: number) {
  return {
    produto: "PH4012",
    desc_produto: "Polo piquet",
    tipo_produto: "1 - MASCULINO",
    linha: "POLO",
    grade: "38",
    cor_codigo: cor,
    cor_nome_portal: nome,
    cor_familia: nome,
    tamanho_key: key,
    tamanho_venda: venda,
    quantidade_estoque: qtd,
    preco: 399,
    sync_concluido_em: SYNC,
  };
}

// Colour 001 has P=0, M=3, G=0; colour 166 has P=1, G=2. Colour 031 is sold
// out (absent from estoque_atual, so absent from the detail RPC).
const DETALHE = [
  detalhe("001", "Branco", 1, "P", 0),
  detalhe("001", "Branco", 2, "M", 3),
  detalhe("001", "Branco", 3, "G", 0),
  detalhe("166", "Marinho", 1, "P", 1),
  detalhe("166", "Marinho", 2, "M", 0),
  detalhe("166", "Marinho", 3, "G", 2),
];

function barcode(over: Record<string, unknown>) {
  return {
    resultado: "DISPONIVEL",
    codigo_barra: "0012345678905",
    produto: "PH4012",
    desc_produto: "Polo piquet",
    cor_codigo: "001",
    cor_nome_portal: "Branco",
    cor_familia: "Branco",
    tamanho_key: 2,
    tamanho_venda: "M",
    quantidade_estoque: 3,
    outras_cores_disponiveis: 1,
    sync_concluido_em: SYNC,
    ...over,
  };
}

function servir(barcodeRow: Record<string, unknown> | null, detalheRows = DETALHE) {
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "get_estoque_por_codigo_barra") {
      return { data: barcodeRow ? [barcodeRow] : [], error: null };
    }
    if (nome === "get_produto_estoque_detalhe") return { data: detalheRows, error: null };
    return { data: [], error: null };
  });
}

function renderView(codigo: string, produtoFallback: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(CodigoBarraResultadoView, { sessionToken: "tok", codigo, produtoFallback }),
    ),
  );
}

function linhasDeCor(): string[] {
  const tabela = screen.getByRole("table");
  return within(tabela)
    .getAllByRole("rowheader")
    .map((th) => th.textContent ?? "");
}

beforeEach(() => rpc.mockReset());

describe("CodigoBarraResultadoView", () => {
  it("sends the barcode as a string with leading zeros intact", async () => {
    servir(barcode({}));
    renderView("0012345678905");
    await screen.findByRole("table");
    expect(rpc).toHaveBeenCalledWith("get_estoque_por_codigo_barra", {
      p_session_token: "tok",
      p_codigo_barra: "0012345678905",
    });
    expect(rpc).toHaveBeenCalledWith("get_produto_estoque_detalhe", {
      p_session_token: "tok",
      p_produto: "PH4012",
    });
  });

  it("DISPONIVEL: scanned colour only, every size, blank zeros, scanned cell outlined", async () => {
    servir(barcode({}));
    renderView("0012345678905");
    await screen.findByRole("table");
    expect(linhasDeCor()).toHaveLength(1);
    expect(linhasDeCor()[0]).toContain("001");
    expect(linhasDeCor()[0]).toContain("Branco");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["P", "M", "G"]));
    const destaque = document.querySelector('td[data-destaque="true"]');
    expect(destaque?.textContent).toBe("3");
    // zero-stock sizes stay blank cells, never "0"
    const celulas = within(screen.getByRole("table")).getAllByRole("cell");
    expect(celulas.some((c) => c.textContent === "0")).toBe(false);
    expect(screen.getByText("Tamanho M: 3 peças em estoque")).toBeTruthy();
  });

  it("Todas as cores shows the reference-wide matrix and Esta cor returns", async () => {
    servir(barcode({}));
    renderView("0012345678905");
    await screen.findByRole("table");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Todas as cores" }));
    fireEvent.click(screen.getByRole("tab", { name: "Todas as cores" }));
    expect(linhasDeCor()).toHaveLength(2);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Esta cor" }));
    fireEvent.click(screen.getByRole("tab", { name: "Esta cor" }));
    expect(linhasDeCor()).toHaveLength(1);
  });

  it("TAMANHO_ESGOTADO: same matrix with sold-out size feedback", async () => {
    servir(
      barcode({
        resultado: "TAMANHO_ESGOTADO",
        tamanho_key: 1,
        tamanho_venda: "P",
        quantidade_estoque: 0,
      }),
    );
    renderView("0012345678912");
    await screen.findByRole("table");
    expect(screen.getByText("Tamanho P esgotado nesta cor")).toBeTruthy();
    expect(linhasDeCor()).toHaveLength(1);
    expect(document.querySelector('td[data-destaque="true"]')?.textContent).toBe("");
  });

  it("COR_ESGOTADA: identifies the sold-out colour and offers the other colours", async () => {
    servir(
      barcode({
        resultado: "COR_ESGOTADA",
        cor_codigo: "031",
        cor_nome_portal: "Vermelho",
        quantidade_estoque: 0,
        outras_cores_disponiveis: 2,
      }),
    );
    renderView("0012345678929");
    expect(await screen.findByText("Esta cor está esgotada")).toBeTruthy();
    expect(screen.getByText("Cor 031 — Vermelho · 2 outras cores disponíveis")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver outras cores disponíveis" }));
    await screen.findByRole("table");
    expect(linhasDeCor()).toHaveLength(2);
  });

  it("REFERENCIA_ESGOTADA: recognizes the product and shows Produto sem estoque", async () => {
    servir(
      barcode({
        resultado: "REFERENCIA_ESGOTADA",
        quantidade_estoque: 0,
        outras_cores_disponiveis: 0,
      }),
      [],
    );
    renderView("0012345678936");
    expect(await screen.findByText("Produto sem estoque")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "PH4012" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("get_produto_estoque_detalhe", expect.anything());
  });

  it("NAO_ENCONTRADO: Código de barras não encontrado (digits-only code)", async () => {
    servir(
      barcode({
        resultado: "NAO_ENCONTRADO",
        codigo_barra: "0000000000000",
        produto: null,
        desc_produto: null,
        cor_codigo: null,
        cor_nome_portal: null,
        cor_familia: null,
        tamanho_key: null,
        tamanho_venda: null,
        quantidade_estoque: null,
        outras_cores_disponiveis: null,
      }),
    );
    renderView("0000000000000");
    expect(await screen.findByText("Código de barras não encontrado")).toBeTruthy();
    expect(screen.getByText("0000000000000")).toBeTruthy();
  });

  it("NAO_ENCONTRADO with an alphanumeric code falls back to the produto search result", async () => {
    servir({
      resultado: "NAO_ENCONTRADO",
      codigo_barra: "PH4012XXXXXX",
      produto: null,
      desc_produto: null,
      cor_codigo: null,
      cor_nome_portal: null,
      cor_familia: null,
      tamanho_key: null,
      tamanho_venda: null,
      quantidade_estoque: null,
      outras_cores_disponiveis: null,
      sync_concluido_em: SYNC,
    });
    renderView("PH4012XXXXXX", "PH4012");
    await screen.findByRole("table");
    expect(linhasDeCor()).toHaveLength(2);
  });

  it("shows a retry on a transient RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    renderView("0012345678905");
    expect(
      await screen.findByText("Não foi possível consultar o código de barras. Tente novamente."),
    ).toBeTruthy();
  });
});
