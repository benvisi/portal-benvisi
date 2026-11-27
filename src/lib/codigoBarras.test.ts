import { describe, expect, it } from "vitest";

import { isEstoqueCodigoBarraResultado } from "@/integrations/supabase/contracts";
import {
  filtrarMatrizPorCor,
  isCandidatoCodigoBarra,
  isCodigoBarraSomenteDigitos,
  normalizarCodigoBarra,
} from "@/lib/codigoBarras";
import { buildEstoqueMatriz } from "@/lib/estoque";

describe("isCandidatoCodigoBarra", () => {
  it("accepts standard numeric barcodes (EAN-8/13, ITF-14)", () => {
    expect(isCandidatoCodigoBarra("12345670")).toBe(true);
    expect(isCandidatoCodigoBarra("3614037654321")).toBe(true);
    expect(isCandidatoCodigoBarra("00012345678905")).toBe(true);
  });

  it("does not treat every numeric term as a barcode", () => {
    expect(isCandidatoCodigoBarra("12")).toBe(false);
    expect(isCandidatoCodigoBarra("4012")).toBe(false);
    expect(isCandidatoCodigoBarra("1234567")).toBe(false);
  });

  it("keeps references and text searches on the ordinary path", () => {
    expect(isCandidatoCodigoBarra("PH4012")).toBe(false);
    expect(isCandidatoCodigoBarra("46SMA0045BR")).toBe(false); // 11 chars, longest reference
    expect(isCandidatoCodigoBarra("polo azul")).toBe(false);
    expect(isCandidatoCodigoBarra("3614037 654321")).toBe(false);
  });

  it("accepts long alphanumeric single tokens (internal Linx codes)", () => {
    expect(isCandidatoCodigoBarra("PH4012001P2X")).toBe(true);
  });

  it("rejects blank and over-length input", () => {
    expect(isCandidatoCodigoBarra("   ")).toBe(false);
    expect(isCandidatoCodigoBarra("1".repeat(65))).toBe(false);
  });

  it("trims scanner terminators but keeps leading zeros", () => {
    expect(normalizarCodigoBarra("  0012345678905\r\n")).toBe("0012345678905");
    expect(isCodigoBarraSomenteDigitos("0012345678905")).toBe(true);
    expect(isCodigoBarraSomenteDigitos("PH4012001P2X")).toBe(false);
  });
});

describe("filtrarMatrizPorCor", () => {
  const base = {
    produto: "PH4012",
    desc_produto: "Polo",
    tipo_produto: null,
    linha: null,
    grade: "38",
    cor_nome_portal: null,
    cor_familia: null,
    preco: 399,
    sync_concluido_em: "2026-11-27T12:00:00Z",
  };
  const matriz = buildEstoqueMatriz([
    { ...base, cor_codigo: "001", tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 0 },
    { ...base, cor_codigo: "001", tamanho_key: 2, tamanho_venda: "M", quantidade_estoque: 3 },
    { ...base, cor_codigo: "166", tamanho_key: 1, tamanho_venda: "P", quantidade_estoque: 1 },
    { ...base, cor_codigo: "166", tamanho_key: 3, tamanho_venda: "G", quantidade_estoque: 2 },
  ])!;

  it("keeps one colour and every applicable size column (zero sizes included)", () => {
    const filtrada = filtrarMatrizPorCor(matriz, "001")!;
    expect(filtrada.cores.map((c) => c.codigo)).toEqual(["001"]);
    expect(filtrada.tamanhos.map((t) => t.venda)).toEqual(["P", "M", "G"]);
    expect(filtrada.cores[0].quantidades.get(1)).toBe(0);
  });

  it("returns null for a colour absent from the snapshot", () => {
    expect(filtrarMatrizPorCor(matriz, "999")).toBeNull();
  });
});

describe("isEstoqueCodigoBarraResultado", () => {
  const ok = {
    resultado: "DISPONIVEL",
    codigo_barra: "0012345678905",
    produto: "PH4012",
    desc_produto: "Polo",
    cor_codigo: "001",
    cor_nome_portal: "Branco",
    cor_familia: "Branco",
    tamanho_key: 2,
    tamanho_venda: "M",
    quantidade_estoque: 3,
    outras_cores_disponiveis: 1,
    sync_concluido_em: "2026-11-27T12:00:00Z",
  };

  it("accepts a recognized row and a NAO_ENCONTRADO row", () => {
    expect(isEstoqueCodigoBarraResultado(ok)).toBe(true);
    expect(
      isEstoqueCodigoBarraResultado({
        ...ok,
        resultado: "NAO_ENCONTRADO",
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
    ).toBe(true);
  });

  it("rejects a numeric barcode, unknown outcome or recognized row without SKU", () => {
    expect(isEstoqueCodigoBarraResultado({ ...ok, codigo_barra: 12345678905 })).toBe(false);
    expect(isEstoqueCodigoBarraResultado({ ...ok, resultado: "OUTRO" })).toBe(false);
    expect(isEstoqueCodigoBarraResultado({ ...ok, produto: null })).toBe(false);
  });
});
