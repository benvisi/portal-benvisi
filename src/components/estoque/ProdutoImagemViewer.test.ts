// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstoqueMatrix } from "@/components/estoque/EstoqueMatrix";
import { ProdutoImagemViewer } from "@/components/estoque/ProdutoImagemViewer";
import { ESTOQUE_IMAGEM_ERRO_MESSAGE } from "@/config/constants";
import { buildEstoqueMatriz } from "@/lib/estoque";
import type { ImagensDaCor } from "@/lib/produtoImagensPublicadas";
import type { EstoqueProdutoDetalheLinha } from "@/integrations/supabase/contracts";

afterEach(cleanup);

function linha(cor: string, nome: string): EstoqueProdutoDetalheLinha {
  return {
    produto: "46SMA0045BR",
    desc_produto: "Polo",
    tipo_produto: "1 - MASCULINO",
    linha: "POLO",
    grade: "38",
    cor_codigo: cor,
    cor_nome_portal: nome,
    cor_familia: nome,
    tamanho_key: 1,
    tamanho_venda: "P",
    quantidade_estoque: 2,
    preco: 399,
    sync_concluido_em: "2026-11-05T12:00:00Z",
  };
}

const matriz = buildEstoqueMatriz([linha("02H", "Verde"), linha("1R5", "Azul")]);
const imagens = new Map<string, ImagensDaCor>([
  ["02H", { principal: "https://cdn.test/p.webp", secundaria: "https://cdn.test/s.webp" }],
]);

describe("EstoqueMatrix image icon", () => {
  it("shows the icon only for the colour with a published image", () => {
    const onVerImagens = vi.fn();
    render(createElement(EstoqueMatrix, { matriz: matriz!, imagens, onVerImagens }));
    const botao = screen.getByRole("button", { name: "Ver imagens da cor 02H" });
    expect(screen.queryByRole("button", { name: /1R5/ })).toBeNull();
    fireEvent.click(botao);
    expect(onVerImagens).toHaveBeenCalledWith("02H");
    // colour code and description stay visible
    expect(screen.getByText("Verde")).toBeTruthy();
    expect(screen.getByText("Azul")).toBeTruthy();
  });

  it("renders no icons without image data", () => {
    render(createElement(EstoqueMatrix, { matriz: matriz! }));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("ProdutoImagemViewer", () => {
  const renderViewer = (onClose = vi.fn(), img = imagens.get("02H")!) =>
    render(
      createElement(ProdutoImagemViewer, {
        produto: "46SMA0045BR",
        corCodigo: "02H",
        imagens: img,
        onClose,
      }),
    );
  const src = () => (screen.getByRole("img") as HTMLImageElement).src;

  it("opens on the primary image and switches to the secondary", () => {
    renderViewer();
    expect(src()).toBe("https://cdn.test/p.webp");
    fireEvent.click(screen.getByRole("button", { name: "Secundária" }));
    expect(src()).toBe("https://cdn.test/s.webp");
    fireEvent.click(screen.getByRole("button", { name: "Principal" }));
    expect(src()).toBe("https://cdn.test/p.webp");
  });

  it("offers no navigation when there is only a primary image", () => {
    renderViewer(vi.fn(), { principal: "https://cdn.test/p.webp", secundaria: null });
    expect(screen.queryByRole("button", { name: "Secundária" })).toBeNull();
  });

  it("shows a friendly error with retry when the image fails to load", () => {
    renderViewer();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText(ESTOQUE_IMAGEM_ERRO_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("closes through the close button", () => {
    const onClose = vi.fn();
    renderViewer(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
