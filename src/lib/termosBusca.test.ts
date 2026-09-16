import { describe, expect, it } from "vitest";

import {
  TERMOS_BUSCA_ERRO_DESATIVADO_ADMIN_MESSAGE,
  TERMOS_BUSCA_ERRO_DESATIVADO_MESSAGE,
  TERMOS_BUSCA_ERRO_GENERICO_MESSAGE,
  TERMOS_BUSCA_ERRO_JA_APROVADO_MESSAGE,
} from "@/config/constants";
import { canonicalizarTermoBusca, getTermoBuscaErrorMessage } from "@/lib/termosBusca";

describe("canonicalizarTermoBusca", () => {
  it("trims, collapses whitespace and lower-cases while keeping accents", () => {
    expect(canonicalizarTermoBusca("  Gola   ALTA ")).toBe("gola alta");
    expect(canonicalizarTermoBusca("Canelada")).toBe("canelada");
    expect(canonicalizarTermoBusca("MANGA LONGA ")).toBe("manga longa");
    expect(canonicalizarTermoBusca("Logo Grande")).toBe("logo grande");
    expect(canonicalizarTermoBusca("Lã Merino")).toBe("lã merino");
  });

  it("accepts digits and hyphens", () => {
    expect(canonicalizarTermoBusca("t-shirt 2 em 1")).toBe("t-shirt 2 em 1");
  });

  it("rejects out-of-range lengths", () => {
    expect(canonicalizarTermoBusca("ab")).toBeNull();
    expect(canonicalizarTermoBusca("  a  ")).toBeNull();
    expect(canonicalizarTermoBusca("a".repeat(31))).toBeNull();
    expect(canonicalizarTermoBusca("a".repeat(30))).toBe("a".repeat(30));
  });

  it("rejects characters outside letters/digits/space/hyphen and all-punctuation", () => {
    expect(canonicalizarTermoBusca("gola%alta")).toBeNull();
    expect(canonicalizarTermoBusca("gola_alta")).toBeNull();
    expect(canonicalizarTermoBusca("bonita!")).toBeNull();
    expect(canonicalizarTermoBusca("---")).toBeNull();
  });
});

describe("getTermoBuscaErrorMessage", () => {
  it("maps known RPC codes", () => {
    expect(getTermoBuscaErrorMessage({ message: "TERMO_JA_APROVADO" })).toBe(
      TERMOS_BUSCA_ERRO_JA_APROVADO_MESSAGE,
    );
  });

  it("uses management wording for a deactivated term only in admin context", () => {
    expect(getTermoBuscaErrorMessage({ message: "TERMO_DESATIVADO_PELA_GESTAO" })).toBe(
      TERMOS_BUSCA_ERRO_DESATIVADO_MESSAGE,
    );
    expect(getTermoBuscaErrorMessage({ message: "TERMO_DESATIVADO_PELA_GESTAO" }, true)).toBe(
      TERMOS_BUSCA_ERRO_DESATIVADO_ADMIN_MESSAGE,
    );
  });

  it("falls back to the generic message for unknown/non-RPC errors", () => {
    expect(getTermoBuscaErrorMessage(new Error("network"))).toBe(
      TERMOS_BUSCA_ERRO_GENERICO_MESSAGE,
    );
    expect(getTermoBuscaErrorMessage(null)).toBe(TERMOS_BUSCA_ERRO_GENERICO_MESSAGE);
  });
});
