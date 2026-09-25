import { describe, expect, it } from "vitest";

import type { EstoqueProdutoDetalheLinha } from "@/integrations/supabase/contracts";
import { buildEstoqueMatriz } from "@/lib/estoque";

function linha(overrides: Partial<EstoqueProdutoDetalheLinha> = {}): EstoqueProdutoDetalheLinha {
  return {
    produto: "52SMA0038",
    desc_produto: "Tênis masculino",
    tipo_produto: "1 - MASCULINO",
    linha: "COURT SNEAKERS",
    grade: "F1",
    cor_codigo: "001",
    cor_nome_portal: "Branco",
    cor_familia: "Branco",
    tamanho_key: 1,
    tamanho_venda: "6",
    quantidade_estoque: 3,
    preco: 649,
    sync_concluido_em: "2026-09-24T12:00:00Z",
    ...overrides,
  };
}

describe("buildEstoqueMatriz — footwear grade/segmento wiring", () => {
  it("carries grade and classifies segmentoCalcado for a footwear grade (F1 -> masculino)", () => {
    const matriz = buildEstoqueMatriz([linha()]);
    expect(matriz?.grade).toBe("F1");
    expect(matriz?.segmentoCalcado).toBe("masculino");
  });

  it("classifies F2 -> feminino and F62 -> infantil", () => {
    expect(buildEstoqueMatriz([linha({ grade: "F2" })])?.segmentoCalcado).toBe("feminino");
    expect(buildEstoqueMatriz([linha({ grade: "F62" })])?.segmentoCalcado).toBe("infantil");
  });

  it("leaves segmentoCalcado null for non-footwear/unknown grades — never guessed", () => {
    expect(buildEstoqueMatriz([linha({ grade: "38" })])?.segmentoCalcado).toBeNull();
    expect(buildEstoqueMatriz([linha({ grade: null })])?.segmentoCalcado).toBeNull();
  });

  it("returns null for an empty result set", () => {
    expect(buildEstoqueMatriz([])).toBeNull();
  });
});
