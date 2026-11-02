import { describe, expect, it } from "vitest";

import {
  IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
  IMAGENS_PRODUTO_ERRO_MOTIVO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_SEM_PERMISSAO_MESSAGE,
  IMAGENS_PRODUTO_ERRO_TRANSICAO_MESSAGE,
} from "@/config/constants";
import { AVALIACOES, CDN, GALERIA } from "@/lib/produtoImagens.fixtures";
import {
  getImagensProdutoErrorMessage,
  indiceDaRecomendacao,
  montarGaleria,
  selecaoInicial,
  selecaoValida,
} from "@/lib/produtoImagens";

describe("montarGaleria eligibility (frontend mirror of produto_imagem_elegivel)", () => {
  const galeria = montarGaleria(GALERIA, AVALIACOES);
  const porIndice = (i: number) => galeria[i];

  it("keeps the gallery position as the index and normalizes protocol-relative URLs", () => {
    expect(galeria).toHaveLength(8);
    expect(porIndice(2).index).toBe(2);
    expect(porIndice(0).url).toBe(`https:${CDN}/dwaaaa1111/TST_24.jpg`);
    expect(porIndice(0).alt).toBe("frente");
  });

  it("allows only has_person=false and product_only_still=true", () => {
    expect(porIndice(0)).toMatchObject({ elegivel: true, motivo: null });
    expect(porIndice(2)).toMatchObject({ elegivel: true, motivo: null });
  });

  it("excludes images containing people", () => {
    expect(porIndice(1)).toMatchObject({ elegivel: false, motivo: "pessoa" });
  });

  it("treats a contradictory classification (person AND product-only) as ineligible", () => {
    expect(porIndice(5)).toMatchObject({ elegivel: false, motivo: "avaliacao_ambigua" });
  });

  it("treats a missing evaluation as ineligible", () => {
    expect(porIndice(6)).toMatchObject({ elegivel: false, motivo: "sem_avaliacao" });
  });

  it("treats no-person but not-product-only as ineligible", () => {
    expect(porIndice(7)).toMatchObject({ elegivel: false, motivo: "avaliacao_ambigua" });
  });

  it("rejects non-image gallery entries and non-Lacoste hosts even with a good evaluation", () => {
    expect(porIndice(4)).toMatchObject({ elegivel: false, motivo: "nao_e_foto" });
    expect(porIndice(3)).toMatchObject({ elegivel: false, motivo: "origem_nao_permitida" });
    expect(porIndice(3).url).toBeNull();
  });

  it("rejects non-boolean evaluation fields, including string look-alikes", () => {
    const g = montarGaleria(
      [GALERIA[0], GALERIA[2]],
      [
        { index: 0, has_person: "false", product_only_still: "true" },
        { index: 1, has_person: false },
      ],
    );
    expect(g.every((img) => !img.elegivel && img.motivo === "avaliacao_ambigua")).toBe(true);
  });

  it("is not eligible when any duplicate evaluation for an index disagrees", () => {
    const g = montarGaleria(
      [GALERIA[0]],
      [
        { index: 0, has_person: false, product_only_still: true },
        { index: 0, has_person: true, product_only_still: false },
      ],
    );
    expect(g[0].elegivel).toBe(false);
  });

  it("makes everything ineligible when evaluations are missing or malformed", () => {
    for (const avaliacoes of [null, undefined, "x", {}, [null, 3, "y"]]) {
      expect(montarGaleria(GALERIA, avaliacoes).some((img) => img.elegivel)).toBe(false);
    }
  });

  it("returns an empty gallery for a non-array", () => {
    expect(montarGaleria(null, AVALIACOES)).toEqual([]);
    expect(montarGaleria({}, AVALIACOES)).toEqual([]);
  });
});

describe("recommendation and selection", () => {
  const galeria = montarGaleria(GALERIA, AVALIACOES);
  const url = (i: number) => galeria[i].url;

  it("resolves AI recommendations by URL", () => {
    expect(indiceDaRecomendacao(galeria, url(2))).toBe(2);
    expect(indiceDaRecomendacao(galeria, "https://x/y.jpg")).toBeNull();
    expect(indiceDaRecomendacao(galeria, null)).toBeNull();
  });

  it("starts from the AI recommendation only where it is eligible", () => {
    expect(selecaoInicial(galeria, url(0), url(2))).toEqual({ principal: 0, secundaria: 2 });
    // A recommended person image (e.g. stale data) is dropped, never preselected.
    expect(selecaoInicial(galeria, url(1), url(2))).toEqual({ principal: null, secundaria: 2 });
    expect(selecaoInicial(galeria, url(0), url(1))).toEqual({ principal: 0, secundaria: null });
    expect(selecaoInicial(galeria, url(0), url(0))).toEqual({ principal: 0, secundaria: null });
  });

  it("validates a selection only when every chosen index is eligible", () => {
    expect(selecaoValida(galeria, { principal: 0, secundaria: null })).toBe(true);
    expect(selecaoValida(galeria, { principal: 2, secundaria: 0 })).toBe(true);
    expect(selecaoValida(galeria, { principal: null, secundaria: null })).toBe(false);
    expect(selecaoValida(galeria, { principal: 1, secundaria: null })).toBe(false);
    expect(selecaoValida(galeria, { principal: 0, secundaria: 5 })).toBe(false);
    expect(selecaoValida(galeria, { principal: 0, secundaria: 0 })).toBe(false);
    expect(selecaoValida(galeria, { principal: 99, secundaria: null })).toBe(false);
  });
});

describe("getImagensProdutoErrorMessage", () => {
  it("maps known RPC codes to pt-BR copy", () => {
    const msg = (message: string) => getImagensProdutoErrorMessage({ message });
    expect(msg("SEM_PERMISSAO_IMAGENS_PRODUTO")).toBe(IMAGENS_PRODUTO_ERRO_SEM_PERMISSAO_MESSAGE);
    expect(msg("TRANSICAO_INVALIDA")).toBe(IMAGENS_PRODUTO_ERRO_TRANSICAO_MESSAGE);
    expect(msg("IMAGEM_NAO_ELEGIVEL_PESSOA_OU_AVALIACAO_AUSENTE")).toBe(
      IMAGENS_PRODUTO_ERRO_INELEGIVEL_MESSAGE,
    );
    expect(msg("OBSERVACAO_OBRIGATORIA")).toBe(IMAGENS_PRODUTO_ERRO_MOTIVO_MESSAGE);
  });

  it("falls back to a generic message and never echoes raw errors", () => {
    expect(getImagensProdutoErrorMessage({ message: "relation x does not exist" })).toBe(
      IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE,
    );
    expect(getImagensProdutoErrorMessage(null)).toBe(IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE);
    expect(getImagensProdutoErrorMessage("boom")).toBe(IMAGENS_PRODUTO_ERRO_GENERICO_MESSAGE);
  });
});
