import { describe, expect, it } from "vitest";

import {
  classificarSegmentoCalcado,
  converterUkParaBr,
  getTabelaConversaoCalcado,
  normalizeTamanhoCalcado,
} from "@/lib/conversaoTamanhoCalcado";

describe("classificarSegmentoCalcado", () => {
  it("classifies the known footwear grades", () => {
    expect(classificarSegmentoCalcado("F1")).toBe("masculino");
    expect(classificarSegmentoCalcado("F2")).toBe("feminino");
    expect(classificarSegmentoCalcado("F62")).toBe("infantil");
  });

  it("degrades safely for null/unknown/blank grades — never guesses", () => {
    expect(classificarSegmentoCalcado(null)).toBeNull();
    expect(classificarSegmentoCalcado(undefined)).toBeNull();
    expect(classificarSegmentoCalcado("")).toBeNull();
    expect(classificarSegmentoCalcado("XYZ")).toBeNull();
    expect(classificarSegmentoCalcado("U00")).toBeNull();
  });
});

describe("normalizeTamanhoCalcado", () => {
  it("strips exactly one trailing comma (the Linx F62 artifact)", () => {
    expect(normalizeTamanhoCalcado("10,")).toBe("10");
    expect(normalizeTamanhoCalcado("11,")).toBe("11");
    expect(normalizeTamanhoCalcado("11,5,")).toBe("11,5");
    expect(normalizeTamanhoCalcado("12,5,")).toBe("12,5");
    expect(normalizeTamanhoCalcado("13,")).toBe("13");
  });

  it("never touches a legitimate embedded decimal comma", () => {
    expect(normalizeTamanhoCalcado("8,5")).toBe("8,5");
    expect(normalizeTamanhoCalcado("9,5")).toBe("9,5");
    expect(normalizeTamanhoCalcado("10,5")).toBe("10,5");
    expect(normalizeTamanhoCalcado("11,5")).toBe("11,5");
  });

  it("trims whitespace", () => {
    expect(normalizeTamanhoCalcado("  10  ")).toBe("10");
    expect(normalizeTamanhoCalcado(" 10, ")).toBe("10");
  });
});

describe("converterUkParaBr — Masculino (grade F1)", () => {
  it("converts every supplied mapping", () => {
    expect(converterUkParaBr("masculino", "6")).toBe(38);
    expect(converterUkParaBr("masculino", "7")).toBe(39);
    expect(converterUkParaBr("masculino", "8")).toBe(40);
    expect(converterUkParaBr("masculino", "8,5")).toBe(41);
    expect(converterUkParaBr("masculino", "9,5")).toBe(42);
    expect(converterUkParaBr("masculino", "10")).toBe(43);
    expect(converterUkParaBr("masculino", "11")).toBe(44);
  });

  it("returns undefined for real in-stock sizes with no supplied mapping", () => {
    expect(converterUkParaBr("masculino", "9")).toBeUndefined();
    expect(converterUkParaBr("masculino", "10,5")).toBeUndefined();
    expect(converterUkParaBr("masculino", "13,5")).toBeUndefined();
  });
});

describe("converterUkParaBr — Feminino (grade F2)", () => {
  it("converts every supplied mapping", () => {
    expect(converterUkParaBr("feminino", "3,5")).toBe(34);
    expect(converterUkParaBr("feminino", "4")).toBe(35);
    expect(converterUkParaBr("feminino", "5")).toBe(36);
    expect(converterUkParaBr("feminino", "6")).toBe(37);
    expect(converterUkParaBr("feminino", "6,5")).toBe(38);
    expect(converterUkParaBr("feminino", "7,5")).toBe(39);
  });

  it("returns undefined for real in-stock sizes with no supplied mapping", () => {
    expect(converterUkParaBr("feminino", "3")).toBeUndefined();
    expect(converterUkParaBr("feminino", "9")).toBeUndefined();
  });
});

describe("converterUkParaBr — Infantil (grade F62), real observed raw values", () => {
  it("normalizes the trailing-comma raw label and converts every supplied mapping", () => {
    expect(converterUkParaBr("infantil", "10,")).toBe(26);
    expect(converterUkParaBr("infantil", "11,")).toBe(27);
    expect(converterUkParaBr("infantil", "11,5,")).toBe(28);
    expect(converterUkParaBr("infantil", "12,5,")).toBe(29);
    expect(converterUkParaBr("infantil", "13,")).toBe(30);
  });

  it("also accepts the already-normalized form", () => {
    expect(converterUkParaBr("infantil", "10")).toBe(26);
    expect(converterUkParaBr("infantil", "11,5")).toBe(28);
  });

  it("leaves an unmapped real Infantil size (10,5,) unconverted — never guessed", () => {
    expect(converterUkParaBr("infantil", "10,5,")).toBeUndefined();
    expect(converterUkParaBr("infantil", "12,")).toBeUndefined();
    expect(converterUkParaBr("infantil", "13,5,")).toBeUndefined();
    expect(converterUkParaBr("infantil", "1")).toBeUndefined();
  });
});

describe("getTabelaConversaoCalcado", () => {
  it("returns the Masculino table sorted ascending by UK size, matching converterUkParaBr", () => {
    expect(getTabelaConversaoCalcado("masculino")).toEqual([
      ["6", 38],
      ["7", 39],
      ["8", 40],
      ["8,5", 41],
      ["9,5", 42],
      ["10", 43],
      ["11", 44],
    ]);
  });

  it("returns only the supplied (partial) Infantil mappings — never an interpolated one", () => {
    expect(getTabelaConversaoCalcado("infantil")).toEqual([
      ["10", 26],
      ["11", 27],
      ["11,5", 28],
      ["12,5", 29],
      ["13", 30],
    ]);
  });
});
