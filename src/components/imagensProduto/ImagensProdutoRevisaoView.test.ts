// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMAGENS_PRODUTO_APROVADO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_CARREGAR_MESSAGE,
  IMAGENS_PRODUTO_FILA_VAZIO_MESSAGE,
} from "@/config/constants";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useSessionErrorHandler", () => ({ useSessionErrorHandler: () => () => false }));

import { ImagensProdutoRevisaoView } from "@/components/imagensProduto/ImagensProdutoRevisaoView";
import { candidatoFixture } from "@/lib/produtoImagens.fixtures";

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ImagensProdutoRevisaoView, { sessionToken: "tok" }),
    ),
  );
}

const callsTo = (name: string) => rpc.mock.calls.filter(([n]) => n === name).length;

beforeEach(() => {
  rpc.mockReset();
});
afterEach(cleanup);

describe("review queue", () => {
  it("lists pending candidates with product, color, name and pending status", async () => {
    rpc.mockResolvedValue({
      data: [candidatoFixture(), candidatoFixture({ id: "c2", produto: "TST-002" })],
      error: null,
    });
    renderView();

    expect(await screen.findByText("TST-001 · T01")).toBeTruthy();
    expect(screen.getByText("TST-002 · T01")).toBeTruthy();
    expect(screen.getAllByText("Polo de teste")).toHaveLength(2);
    expect(screen.getAllByText("Pendente")).toHaveLength(2);
    expect(screen.getAllByText(/Cor: Azul/)).toHaveLength(2);
  });

  it("shows a friendly empty state", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderView();
    expect(await screen.findByText(IMAGENS_PRODUTO_FILA_VAZIO_MESSAGE)).toBeTruthy();
  });

  it("shows a load error with a retry that refetches", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "network down" } });
    rpc.mockResolvedValueOnce({ data: [candidatoFixture()], error: null });
    renderView();

    expect(await screen.findByText(IMAGENS_PRODUTO_ERRO_CARREGAR_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("TST-001 · T01")).toBeTruthy();
  });
});

describe("post-review state", () => {
  it("refetches the queue after approval and says the images are not yet published", async () => {
    let pendentes = [candidatoFixture()];
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_candidatos_imagem_pendentes") return { data: pendentes, error: null };
      if (name === "aprovar_candidato_imagem") {
        pendentes = [];
        return { data: "pub-1", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Revisar" }));
    fireEvent.click(screen.getByRole("button", { name: "Aprovar seleção" }));
    fireEvent.click(screen.getByText("Confirmar aprovação"));

    expect(await screen.findByText(IMAGENS_PRODUTO_APROVADO_MESSAGE)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(IMAGENS_PRODUTO_FILA_VAZIO_MESSAGE)).toBeTruthy());
    expect(callsTo("get_candidatos_imagem_pendentes")).toBeGreaterThanOrEqual(2);
    expect(callsTo("aprovar_candidato_imagem")).toBe(1);
    // Approval is a database decision only: nothing is uploaded or published here.
    expect(rpc.mock.calls.map(([n]) => n)).not.toContain("ativar_publicacao_imagem");
  });

  it("returns to the queue after rejection", async () => {
    let pendentes = [candidatoFixture()];
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_candidatos_imagem_pendentes") return { data: pendentes, error: null };
      pendentes = [];
      return { data: null, error: null };
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Revisar" }));
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar imagens" }));
    fireEvent.change(screen.getByLabelText("Motivo da rejeição (obrigatório)"), {
      target: { value: "fotos ruins" },
    });
    fireEvent.click(screen.getByText("Confirmar rejeição"));

    expect(await screen.findByText("Imagens rejeitadas.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(IMAGENS_PRODUTO_FILA_VAZIO_MESSAGE)).toBeTruthy());
  });

  it("explains when the open candidate was already reviewed elsewhere", async () => {
    let pendentes = [candidatoFixture()];
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_candidatos_imagem_pendentes") return { data: pendentes, error: null };
      pendentes = [];
      return { data: null, error: { message: "TRANSICAO_INVALIDA", code: "P0001" } };
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Revisar" }));
    fireEvent.click(screen.getByRole("button", { name: "Aprovar seleção" }));
    fireEvent.click(screen.getByText("Confirmar aprovação"));

    expect(await screen.findByText(/já foi revisado por outra pessoa/)).toBeTruthy();
    expect(screen.queryByText(IMAGENS_PRODUTO_APROVADO_MESSAGE)).toBeNull();
  });
});
