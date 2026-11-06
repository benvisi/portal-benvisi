// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE } from "@/config/constants";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useSessionErrorHandler", () => ({ useSessionErrorHandler: () => () => false }));

import { ImagensProdutoDetalhe } from "@/components/imagensProduto/ImagensProdutoDetalhe";
import type { CandidatoImagemPendente } from "@/integrations/supabase/contracts";
import { candidatoFixture } from "@/lib/produtoImagens.fixtures";

const onVoltar = vi.fn();
const onDecidido = vi.fn();

function renderDetalhe(candidato: CandidatoImagemPendente = candidatoFixture()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ImagensProdutoDetalhe, {
        candidato,
        sessionToken: "tok",
        onVoltar,
        onDecidido,
      }),
    ),
  );
}

const click = (el: HTMLElement) => fireEvent.click(el);
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const thumb = (n: number) =>
  screen.getByRole("button", { name: new RegExp(`^Ver imagem ${n}( |$)`) }) as HTMLButtonElement;
const previewSrc = (alt: string) => (screen.getByAltText(alt) as HTMLImageElement).src;

beforeEach(() => {
  rpc.mockReset();
  onVoltar.mockReset();
  onDecidido.mockReset();
});
afterEach(cleanup);

describe("gallery rendering", () => {
  it("shows every retained gallery image as a thumbnail with its position", () => {
    renderDetalhe();
    for (let n = 1; n <= 8; n++) expect(thumb(n)).toBeTruthy();
    expect(screen.getByText(/Imagem \d+ de 8/)).toBeTruthy();
  });

  it("loads images directly from their source URLs", () => {
    renderDetalhe();
    expect(previewSrc("Principal")).toContain("imagesa1.lacoste.com/dw/image/v2/X/dwaaaa1111");
  });

  it("marks person, contradictory, missing and non-photo entries as not eligible", () => {
    renderDetalhe();
    for (const n of [2, 4, 5, 6, 7, 8]) {
      expect(thumb(n).getAttribute("aria-label")).toContain("não elegível");
    }
    for (const n of [1, 3]) {
      expect(thumb(n).getAttribute("aria-label")).not.toContain("não elegível");
    }
  });

  it("flags the AI recommendation and preselects only its eligible images", () => {
    renderDetalhe();
    expect(screen.getAllByText(/Recomendada pela IA: Principal/).length).toBeGreaterThan(0);
    expect(previewSrc("Principal")).toContain("dwaaaa1111");
    expect(previewSrc("Secundária")).toContain("dwcccc3333");
  });
});

describe("reviewer copy", () => {
  it("shows the AI confidence in pt-BR and the internal-note help text", () => {
    renderDetalhe();
    expect(screen.getByText(/Confiança da IA: alta/)).toBeTruthy();
    expect(screen.getByText(/Não é exibida para os vendedores/)).toBeTruthy();
  });

  it("falls back to the raw value for an unknown confidence", () => {
    renderDetalhe(candidatoFixture({ confianca: "weird" }));
    expect(screen.getByText(/Confiança da IA: weird/)).toBeTruthy();
  });
});

describe("selection safeguards", () => {
  it("never lets an image containing a person be selected", () => {
    renderDetalhe();
    click(thumb(2));
    expect(screen.getByText(/Não elegível: Pessoa na imagem/)).toBeTruthy();
    expect(button("Usar como principal").disabled).toBe(true);
    expect(button("Usar como secundária").disabled).toBe(true);
  });

  it("explains missing and contradictory AI evaluations", () => {
    renderDetalhe();
    click(thumb(7));
    expect(screen.getByText(/Sem avaliação da IA/)).toBeTruthy();
    click(thumb(6));
    expect(screen.getByText(/Avaliação da IA inconsistente/)).toBeTruthy();
    expect(button("Usar como principal").disabled).toBe(true);
  });

  it("lets the reviewer pick eligible images other than the AI recommendation", () => {
    renderDetalhe(
      candidatoFixture({
        primary_candidate_url: null,
        secondary_candidate_url: null,
      }),
    );
    expect(button("Aprovar seleção").disabled).toBe(true);
    click(thumb(3));
    click(button("Usar como principal"));
    expect(previewSrc("Principal")).toContain("dwcccc3333");
    expect(button("Aprovar seleção").disabled).toBe(false);
  });

  it("clears the optional secondary selection", () => {
    renderDetalhe();
    click(button("Remover secundária"));
    expect(screen.getByText("Sem imagem secundária")).toBeTruthy();
  });

  it("drops the secondary when it becomes the primary", () => {
    renderDetalhe();
    click(thumb(3));
    click(button("Usar como principal"));
    expect(screen.getByText("Sem imagem secundária")).toBeTruthy();
  });

  it("blocks approval when no image in the gallery is eligible", () => {
    renderDetalhe(
      candidatoFixture({
        avaliacoes_ia: null,
        primary_candidate_url: null,
        secondary_candidate_url: null,
      }),
    );
    expect(screen.getByText(/Nenhuma imagem desta galeria é elegível/)).toBeTruthy();
    expect(button("Aprovar seleção").disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("approval", () => {
  it("approves immediately on click, with no confirmation modal", async () => {
    rpc.mockResolvedValue({ data: "pub-1", error: null });
    renderDetalhe();
    click(button("Aprovar seleção"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDecidido).toHaveBeenCalledWith("aprovado"));
  });

  it("submits the chosen indices and reports the decision only after the RPC confirms", async () => {
    let resolve: (value: unknown) => void = () => {};
    rpc.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDetalhe();

    click(thumb(3));
    click(button("Usar como principal"));
    fireEvent.change(screen.getByLabelText("Observação interna (opcional)"), {
      target: { value: "melhor vista" },
    });
    click(button("Aprovar seleção"));

    expect(rpc).toHaveBeenCalledWith("aprovar_candidato_imagem", {
      p_session_token: "tok",
      p_candidato_id: "c1",
      p_indice_principal: 2,
      p_indice_secundaria: null,
      p_observacao: "melhor vista",
    });
    expect(onDecidido).not.toHaveBeenCalled();

    await act(async () => resolve({ data: "pub-1", error: null }));
    await waitFor(() => expect(onDecidido).toHaveBeenCalledWith("aprovado"));
    expect(onDecidido).toHaveBeenCalledTimes(1);
  });

  it("prevents double submission", async () => {
    let resolve: (value: unknown) => void = () => {};
    rpc.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDetalhe();

    const aprovar = button("Aprovar seleção"); // the label becomes "Enviando..." once busy
    click(aprovar);
    click(aprovar);
    click(aprovar);
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ data: "pub-1", error: null }));
    await waitFor(() => expect(onDecidido).toHaveBeenCalledTimes(1));
  });

  it("shows the server error and does not claim success when the RPC fails", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "IMAGEM_NAO_ELEGIVEL_PESSOA_OU_AVALIACAO_AUSENTE", code: "P0001" },
    });
    renderDetalhe();

    click(button("Aprovar seleção"));

    expect(await screen.findByText(IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE)).toBeTruthy();
    expect(onDecidido).not.toHaveBeenCalled();
    // The reviewer can try again after a failure.
    expect(button("Aprovar seleção").disabled).toBe(false);
  });
});

describe("rejection", () => {
  it("requires a reason before the confirm button is enabled", () => {
    renderDetalhe();
    click(button("Rejeitar imagens"));
    const confirmar = screen.getByText("Confirmar rejeição").closest("button") as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo da rejeição (obrigatório)"), {
      target: { value: "   " },
    });
    expect(confirmar.disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the reason and reports rejection after the RPC confirms", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    renderDetalhe();

    click(button("Rejeitar imagens"));
    fireEvent.change(screen.getByLabelText("Motivo da rejeição (obrigatório)"), {
      target: { value: "fotos ruins" },
    });
    click(screen.getByText("Confirmar rejeição"));

    await waitFor(() => expect(onDecidido).toHaveBeenCalledWith("rejeitado"));
    expect(rpc).toHaveBeenCalledWith("rejeitar_candidato_imagem", {
      p_session_token: "tok",
      p_candidato_id: "c1",
      p_observacao: "fotos ruins",
    });
  });

  it("does not report rejection when the RPC fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "TRANSICAO_INVALIDA" } });
    renderDetalhe();

    click(button("Rejeitar imagens"));
    fireEvent.change(screen.getByLabelText("Motivo da rejeição (obrigatório)"), {
      target: { value: "x" },
    });
    click(screen.getByText("Confirmar rejeição"));

    expect(await screen.findByText(/já foi revisado por outra pessoa/)).toBeTruthy();
    expect(onDecidido).not.toHaveBeenCalled();
  });
});
