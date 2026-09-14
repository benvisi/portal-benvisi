import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildImportPayload,
  escolherCandidataPreselecionada,
  findCandidateSheets,
  parseFilenameMonth,
  parseSheetNameMonth,
  type EscalaFolhaCandidata,
} from "@/lib/escalaXlsx";

function utcDate(ano: number, mesIndex0: number, dia: number): Date {
  return new Date(Date.UTC(ano, mesIndex0, dia));
}

function addDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 86_400_000);
}

interface FuncionarioLinha {
  nome: string;
  valores: (string | null)[];
}

// Mirrors the real workbook's weekly-block shape: a date-header row, a
// FUNCIONÁRIO/FUNÇÃO/day-name label row directly under it, employee rows,
// then coverage/staffing rows — matching the structural manifest for
// `ESCALA DE TRABALHO set 2026 final(2).xlsx`.
function escreverBloco(
  worksheet: ExcelJS.Worksheet,
  linhaInicial: number,
  colunaInicial: number,
  domingo: Date,
  funcionarios: FuncionarioLinha[],
  opts: { comLinhasDeCobertura?: boolean } = {},
): number {
  const datas = Array.from({ length: 7 }, (_, k) => addDias(domingo, k));

  const linhaData = worksheet.getRow(linhaInicial);
  datas.forEach((data, k) => {
    linhaData.getCell(colunaInicial + k).value = data;
  });

  const linhaHeader = worksheet.getRow(linhaInicial + 1);
  linhaHeader.getCell(1).value = "FUNCIONÁRIO";
  linhaHeader.getCell(2).value = "FUNÇÃO";

  let linhaAtual = linhaInicial + 2;
  for (const funcionario of funcionarios) {
    const row = worksheet.getRow(linhaAtual);
    row.getCell(1).value = funcionario.nome;
    funcionario.valores.forEach((valor, k) => {
      if (valor !== null) row.getCell(colunaInicial + k).value = valor;
    });
    linhaAtual += 1;
  }

  if (opts.comLinhasDeCobertura ?? true) {
    for (const rotulo of [
      "Vendedor diurno",
      "Vendedor notourno",
      "Caixa diurno",
      "Caixa notourno",
    ]) {
      const row = worksheet.getRow(linhaAtual);
      row.getCell(1).value = rotulo;
      row.getCell(colunaInicial).value = 0;
      linhaAtual += 1;
    }
  }

  return linhaAtual; // first free row after this block
}

describe("parseSheetNameMonth", () => {
  it("matches an exact '<mês> <ano>' sheet name, abbreviated or full", () => {
    expect(parseSheetNameMonth("setembro 2026")).toEqual({ ano: 2026, mes: 9 });
    expect(parseSheetNameMonth("set 2026")).toEqual({ ano: 2026, mes: 9 });
    expect(parseSheetNameMonth("SETEMBRO 2026")).toEqual({ ano: 2026, mes: 9 });
    expect(parseSheetNameMonth("  outubro 2026  ")).toEqual({ ano: 2026, mes: 10 });
  });

  it("rejects a suffixed/non-canonical sheet name", () => {
    expect(parseSheetNameMonth("mar 2026 - original")).toBeNull();
    expect(parseSheetNameMonth("Configurações")).toBeNull();
    expect(parseSheetNameMonth("Férias 2026")).toBeNull();
    expect(parseSheetNameMonth("Feriados 2026")).toBeNull();
  });
});

describe("findCandidateSheets", () => {
  it("finds monthly sheets by name + real date structure, ignoring visibility and non-matching sheets", async () => {
    const workbook = new ExcelJS.Workbook();

    const setembro = workbook.addWorksheet("setembro 2026");
    escreverBloco(setembro, 1, 3, utcDate(2026, 8, 30), [{ nome: "AMANDA", valores: ["FOLGA"] }]);

    // A hidden sheet must still be a candidate — sheet visibility is
    // irrelevant to import eligibility.
    const outubro = workbook.addWorksheet("outubro 2026", { state: "hidden" });
    escreverBloco(outubro, 1, 3, utcDate(2026, 9, 4), [{ nome: "AMANDA", valores: ["FOLGA"] }]);

    // Matches no month-name pattern at all.
    workbook.addWorksheet("Configurações");

    // Suffixed — must not be offered as "março 2026".
    const marOriginal = workbook.addWorksheet("mar 2026 - original");
    escreverBloco(marOriginal, 1, 3, utcDate(2026, 2, 1), [{ nome: "AMANDA", valores: ["FOLGA"] }]);

    // Matches the name pattern but has no real date structure at all — must
    // not be offered as a candidate.
    workbook.addWorksheet("novembro 2026");

    const candidatas = findCandidateSheets(workbook);
    const nomes = candidatas.map((c) => c.sheetName).sort();

    expect(nomes).toEqual(["outubro 2026", "setembro 2026"]);

    const setembroCandidata = candidatas.find((c) => c.sheetName === "setembro 2026");
    expect(setembroCandidata).toEqual({
      sheetName: "setembro 2026",
      ano: 2026,
      mes: 9,
      rotulo: "Setembro/2026",
    });
  });
});

describe("buildImportPayload", () => {
  it("extracts only target-month cells, drops spillover, staffing rows, and blanks", () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("setembro 2026");

    // Domingo 30/08/2026 .. Sábado 05/09/2026 — the real Bloco 1 shape:
    // two spillover (August) columns, five real September columns.
    escreverBloco(worksheet, 1, 3, utcDate(2026, 7, 30), [
      { nome: "AMANDA", valores: [null, null, "FÉRIAS", "FÉRIAS", "FÉRIAS", "FÉRIAS", "FÉRIAS"] },
      {
        nome: "GRAÇA",
        valores: [null, null, "10:00-16:00", "10:00-16:00", null, "10:00-16:00", "10:00-16:00"],
      },
      { nome: "MONICA", valores: [null, null, null, null, null, null, null] },
    ]);

    const payload = buildImportPayload(workbook, "setembro 2026", 2026, 9);

    // All three row-header names are present (roster presence is per row,
    // regardless of how many cells they have data in).
    expect(payload.funcionariosPlanilha.sort()).toEqual(["AMANDA", "GRAÇA", "MONICA"]);

    // Spillover (30/08, 31/08) never appears, even though those columns had
    // real values for other employees in the same block.
    expect(payload.entradas.some((e) => e.data === "2026-08-30" || e.data === "2026-08-31")).toBe(
      false,
    );

    // Staffing/coverage rows never appear as entries.
    expect(payload.entradas.some((e) => e.nome_planilha.toLowerCase().includes("diurno"))).toBe(
      false,
    );

    // A blank cell (Graça, 03/09) produces no entry at all — never a
    // fabricated status.
    expect(
      payload.entradas.some((e) => e.nome_planilha === "GRAÇA" && e.data === "2026-09-03"),
    ).toBe(false);

    // Monica: present in the roster, zero entries for the month.
    expect(payload.entradas.some((e) => e.nome_planilha === "MONICA")).toBe(false);

    // Amanda's five real September FÉRIAS cells all came through.
    const amandaDatas = payload.entradas
      .filter((e) => e.nome_planilha === "AMANDA")
      .map((e) => e.data)
      .sort();
    expect(amandaDatas).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("includes hidden employee rows and never reads the hidden FUNÇÃO column for identity", () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("setembro 2026");

    escreverBloco(worksheet, 1, 3, utcDate(2026, 7, 30), [
      { nome: "RENAN", valores: [null, null, "10:00-16:00", null, null, null, null] },
    ]);

    // Hide the employee row and the FUNÇÃO column, matching the real
    // workbook's structure (column B hidden, and rows can be hidden too).
    worksheet.getRow(3).hidden = true;
    worksheet.getColumn(2).hidden = true;
    worksheet.getRow(3).getCell(2).value = "VENDEDOR";

    const payload = buildImportPayload(workbook, "setembro 2026", 2026, 9);

    expect(payload.funcionariosPlanilha).toEqual(["RENAN"]);
    expect(payload.entradas).toEqual([
      { nome_planilha: "RENAN", data: "2026-09-01", valor: "10:00-16:00" },
    ]);
  });

  it("never reaches a footer/note row past the staffing rows", () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("setembro 2026");

    const proximaLinhaLivre = escreverBloco(worksheet, 1, 3, utcDate(2026, 7, 30), [
      { nome: "AMANDA", valores: [null, null, "FOLGA", null, null, null, null] },
    ]);

    // Blank separator row, then a footer/observation row far below the
    // block — must never be picked up as an "employee".
    worksheet.getRow(proximaLinhaLivre + 1).getCell(1).value =
      "*OBS: Horários podem ser alterados, conforme necessidade operacional.*";

    const payload = buildImportPayload(workbook, "setembro 2026", 2026, 9);

    expect(payload.funcionariosPlanilha).toEqual(["AMANDA"]);
    expect(payload.entradas.some((e) => e.nome_planilha.startsWith("*OBS"))).toBe(false);
  });

  it("handles multiple weekly blocks in one sheet, accumulating across them", () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("setembro 2026");

    const proximaLinha = escreverBloco(worksheet, 1, 3, utcDate(2026, 7, 30), [
      { nome: "AMANDA", valores: [null, null, "FOLGA", null, null, null, null] },
    ]);
    worksheet.getRow(proximaLinha).getCell(1).value = undefined; // blank separator
    escreverBloco(worksheet, proximaLinha + 1, 3, utcDate(2026, 8, 6), [
      { nome: "AMANDA", valores: ["FOLGA", null, null, null, null, null, null] },
    ]);

    const payload = buildImportPayload(workbook, "setembro 2026", 2026, 9);

    const amandaDatas = payload.entradas
      .filter((e) => e.nome_planilha === "AMANDA")
      .map((e) => e.data)
      .sort();
    expect(amandaDatas).toEqual(["2026-09-01", "2026-09-06"]);
  });
});

describe("parseFilenameMonth", () => {
  it("finds an abbreviated month + year in a real-shaped file name", () => {
    expect(parseFilenameMonth("ESCALA DE TRABALHO set 2026 final.xlsx")).toEqual({
      ano: 2026,
      mes: 9,
    });
  });

  it("finds a full month name + year regardless of separators/case", () => {
    expect(parseFilenameMonth("Escala_outubro_2026.xlsx")).toEqual({ ano: 2026, mes: 10 });
    expect(parseFilenameMonth("ESCALA JANEIRO2026.xlsx")).toEqual({ ano: 2026, mes: 1 });
  });

  it("returns null when no month/year pair is present", () => {
    expect(parseFilenameMonth("ESCALA DE TRABALHO final.xlsx")).toBeNull();
    expect(parseFilenameMonth("planilha.xlsx")).toBeNull();
  });

  it("returns null when the file name contains more than one distinct month/year pair", () => {
    expect(parseFilenameMonth("escala jan 2026 e set 2026.xlsx")).toBeNull();
  });
});

describe("escolherCandidataPreselecionada", () => {
  const setembro: EscalaFolhaCandidata = {
    sheetName: "setembro 2026",
    ano: 2026,
    mes: 9,
    rotulo: "Setembro/2026",
  };
  const outubro: EscalaFolhaCandidata = {
    sheetName: "outubro 2026",
    ano: 2026,
    mes: 10,
    rotulo: "Outubro/2026",
  };
  const janeiro: EscalaFolhaCandidata = {
    sheetName: "jan 2026",
    ano: 2026,
    mes: 1,
    rotulo: "Janeiro/2026",
  };

  it("auto-selects the only valid candidate, regardless of file name", () => {
    expect(escolherCandidataPreselecionada([setembro], "qualquer-nome.xlsx")).toEqual(setembro);
  });

  it("auto-selects the candidate the file name reliably identifies among several", () => {
    expect(
      escolherCandidataPreselecionada(
        [janeiro, setembro, outubro],
        "ESCALA DE TRABALHO set 2026 final.xlsx",
      ),
    ).toEqual(setembro);
  });

  it("never preselects anything when multiple candidates exist and the file name is absent/ambiguous", () => {
    expect(escolherCandidataPreselecionada([janeiro, setembro, outubro], "escala.xlsx")).toBeNull();
    expect(
      escolherCandidataPreselecionada([janeiro, setembro, outubro], "escala-2026-final.xlsx"),
    ).toBeNull();
  });

  it("never preselects when the file name matches more than one candidate", () => {
    // A duplicated/renamed sheet could in principle produce two candidates
    // for the same (ano, mes) — must still require an explicit choice.
    const setembroDuplicada: EscalaFolhaCandidata = { ...setembro, sheetName: "setembro 2026 (2)" };
    expect(
      escolherCandidataPreselecionada(
        [setembro, setembroDuplicada],
        "ESCALA DE TRABALHO set 2026 final.xlsx",
      ),
    ).toBeNull();
  });

  it("never uses sheet visibility or populated-cell count as a signal", () => {
    // escolherCandidataPreselecionada only ever sees EscalaFolhaCandidata,
    // which carries no visibility/row-count information at all — this test
    // documents that guarantee at the type level: the function cannot base
    // its decision on data it structurally does not receive.
    const candidatas: EscalaFolhaCandidata[] = [janeiro, outubro];
    expect(escolherCandidataPreselecionada(candidatas, "sem correspondencia.xlsx")).toBeNull();
  });
});
