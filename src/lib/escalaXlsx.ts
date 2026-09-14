import ExcelJS from "exceljs";

// Structural .xlsx parsing for the Escala admin uploader (V1.1). This module
// does NOT interpret cell values as business rules (FOLGA/FÉRIAS/hours/
// MANHÃ-TARDE) — it only locates weekly schedule blocks, the employee rows
// inside them, and extracts raw (nome_planilha, data, valor) tuples for the
// target month. All value normalization/validation is authoritative
// server-side, in escala_processar_importacao
// (supabase/migrations/20260914_004_add_escala_processar_importacao_rpc.sql).
//
// Deliberately does NOT special-case:
//   - hidden rows (an employee row can be hidden for presentation reasons —
//     ExcelJS's row/cell access does not skip them, and neither do we);
//   - hidden columns (identity only ever comes from column A; nothing here
//     reads column B/FUNÇÃO, hidden or not);
//   - hidden/visible worksheet state (workbook.worksheets already includes
//     hidden sheets — see the real workbook's structural manifest: old
//     monthly tabs stay visible-irrelevant candidates).
// See docs/portal-benvisi-blueprint.md and the attached structural manifest
// for the real workbook facts this parser is built against.

const DIAS_POR_BLOCO = 7;

const PALAVRAS_LINHA_COBERTURA = ["diurno", "noturno", "notourno"];

const MESES_PT: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  marco: 3,
  março: 3,
  abr: 4,
  abril: 4,
  mai: 5,
  maio: 5,
  jun: 6,
  junho: 6,
  jul: 7,
  julho: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  setembro: 9,
  out: 10,
  outubro: 10,
  nov: 11,
  novembro: 11,
  dez: 12,
  dezembro: 12,
};

const MESES_ROTULO = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export interface EscalaFolhaMes {
  ano: number;
  mes: number;
}

export interface EscalaFolhaCandidata extends EscalaFolhaMes {
  sheetName: string;
  rotulo: string;
}

export interface EscalaCelulaEntrada {
  nome_planilha: string;
  data: string;
  valor: string;
}

export interface EscalaImportPayload {
  funcionariosPlanilha: string[];
  entradas: EscalaCelulaEntrada[];
}

// Sheet name -> {ano, mes}. Exact match only ("setembro 2026" matches,
// "mar 2026 - original" does not) — an extra suffix is exactly the signal
// that a sheet is not a clean canonical month and should not be offered as
// a candidate.
export function parseSheetNameMonth(sheetName: string): EscalaFolhaMes | null {
  const trimmed = sheetName.trim().toLowerCase();
  const match = /^([a-zà-ÿ]+)\s+(\d{4})$/i.exec(trimmed);
  if (!match) return null;
  const [, palavra, anoStr] = match;
  const mes = MESES_PT[palavra];
  if (!mes) return null;
  return { ano: Number(anoStr), mes };
}

function formatRotulo(folha: EscalaFolhaMes): string {
  return `${MESES_ROTULO[folha.mes - 1]}/${folha.ano}`;
}

// Looks for a month-name token directly adjacent to a 4-digit year token
// anywhere in the (extensionless) file name — e.g. "ESCALA DE TRABALHO set
// 2026 final.xlsx" -> {ano: 2026, mes: 9}. Deliberately conservative: if the
// file name yields more than one *distinct* month/year pair, that's treated
// as no reliable match at all (null) rather than guessing which one is
// meant — ambiguity here must fall through to requiring an explicit Admin
// choice, never a silent pick.
export function parseFilenameMonth(nomeArquivo: string): EscalaFolhaMes | null {
  const semExtensao = nomeArquivo.replace(/\.[^.]+$/, "");
  const tokens = semExtensao.toLowerCase().match(/[a-zà-ÿ]+|\d+/g) ?? [];

  const encontrados: EscalaFolhaMes[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const mes = MESES_PT[tokens[i]];
    if (!mes) continue;

    const vizinhos = [tokens[i + 1], tokens[i - 1]];
    for (const vizinho of vizinhos) {
      if (vizinho && /^\d{4}$/.test(vizinho)) {
        encontrados.push({ ano: Number(vizinho), mes });
      }
    }
  }

  const distintos = new Set(encontrados.map((e) => `${e.ano}-${e.mes}`));
  return distintos.size === 1 ? encontrados[0] : null;
}

// Decides whether a monthly sheet can be safely preselected without Admin
// input — never based on sheet visibility or how much data a sheet
// contains. Only two cases are safe to auto-select:
//   1. exactly one valid monthly sheet exists at all;
//   2. the file name reliably identifies exactly one month/year, and
//      exactly one candidate sheet matches it.
// Any other case (multiple valid sheets, file name ambiguous/absent/
// matching more than one candidate) returns null — the Admin must choose
// explicitly before anything is parsed/validated.
export function escolherCandidataPreselecionada(
  candidatas: EscalaFolhaCandidata[],
  nomeArquivo: string,
): EscalaFolhaCandidata | null {
  if (candidatas.length === 0) return null;
  if (candidatas.length === 1) return candidatas[0];

  const doArquivo = parseFilenameMonth(nomeArquivo);
  if (!doArquivo) return null;

  const correspondentes = candidatas.filter(
    (c) => c.ano === doArquivo.ano && c.mes === doArquivo.mes,
  );
  return correspondentes.length === 1 ? correspondentes[0] : null;
}

function unwrapFormulaValue(value: ExcelJS.CellValue): ExcelJS.CellValue {
  if (value !== null && typeof value === "object" && "result" in value) {
    return (value as { result: ExcelJS.CellValue }).result;
  }
  return value;
}

// Excel's serial-date epoch (including the historical 1900 leap-year bug) is
// 1899-12-30. Only used as a fallback — ExcelJS normally already returns a
// JS Date for date-formatted cells, literal or formula-derived.
function excelSerialToDate(serial: number): Date {
  const utcMillis = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(utcMillis);
}

function getCellDateValue(cell: ExcelJS.Cell): Date | null {
  const value = unwrapFormulaValue(cell.value);
  if (value instanceof Date) return value;
  if (typeof value === "number") return excelSerialToDate(value);
  return null;
}

function getCellRawString(cell: ExcelJS.Cell): string {
  const value = unwrapFormulaValue(cell.value);
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return "";
  if (typeof value === "object" && "richText" in value) {
    return value.richText
      .map((run) => run.text)
      .join("")
      .trim();
  }
  return String(value).trim();
}

function dataParaISO(data: Date): string {
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(data.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function ehLinhaDeCobertura(valor: string): boolean {
  const v = valor.toLowerCase();
  return PALAVRAS_LINHA_COBERTURA.some((palavra) => v.includes(palavra));
}

interface BlocoAnchor {
  linhaData: number;
  colunaInicial: number;
  datas: Date[];
}

// A block anchor is a row containing 7 consecutive date-valued cells, each
// exactly one calendar day after the previous — the same structural signal
// regardless of hidden rows/columns, formulas, or formatting. This is the
// one reliable anchor the real workbook guarantees (see the structural
// manifest: D1 = C1+1 etc.), so detection is driven entirely by actual date
// content, never by column position, row hiding, or sheet visibility.
function encontrarAnchorsDeBloco(worksheet: ExcelJS.Worksheet): BlocoAnchor[] {
  const anchors: BlocoAnchor[] = [];
  const maxRow = worksheet.rowCount;
  const maxCol = Math.max(worksheet.columnCount, DIAS_POR_BLOCO + 3);

  for (let linha = 1; linha <= maxRow; linha++) {
    const row = worksheet.getRow(linha);

    for (let coluna = 1; coluna <= maxCol - (DIAS_POR_BLOCO - 1); coluna++) {
      const datas: Date[] = [];
      let ok = true;

      for (let k = 0; k < DIAS_POR_BLOCO; k++) {
        const data = getCellDateValue(row.getCell(coluna + k));
        if (!data) {
          ok = false;
          break;
        }
        datas.push(data);
      }
      if (!ok) continue;

      let consecutivo = true;
      for (let k = 1; k < datas.length; k++) {
        const diffDias = Math.round((datas[k].getTime() - datas[k - 1].getTime()) / 86_400_000);
        if (diffDias !== 1) {
          consecutivo = false;
          break;
        }
      }

      if (consecutivo) {
        anchors.push({ linhaData: linha, colunaInicial: coluna, datas });
        break;
      }
    }
  }

  return anchors;
}

export function findCandidateSheets(workbook: ExcelJS.Workbook): EscalaFolhaCandidata[] {
  const candidatas: EscalaFolhaCandidata[] = [];

  for (const worksheet of workbook.worksheets) {
    const folhaMes = parseSheetNameMonth(worksheet.name);
    if (!folhaMes) continue;

    const anchors = encontrarAnchorsDeBloco(worksheet);
    if (anchors.length === 0) continue;

    candidatas.push({
      sheetName: worksheet.name,
      ano: folhaMes.ano,
      mes: folhaMes.mes,
      rotulo: formatRotulo(folhaMes),
    });
  }

  return candidatas;
}

// Employee rows run from two rows below the anchor (skipping the date row
// itself and the FUNCIONÁRIO/FUNÇÃO/day-name header row directly under it)
// until: a blank column-A cell, a staffing/coverage-count row
// (Vendedor/Caixa diurno/noturno), or the next block's own anchor row —
// whichever comes first. Only cells whose actual date falls within the
// target month are kept; prior/next-month spillover columns in the same
// weekly block are dropped here, at the source.
function extrairBloco(
  worksheet: ExcelJS.Worksheet,
  anchor: BlocoAnchor,
  proximoAnchorLinha: number | null,
  ano: number,
  mes: number,
): { nomes: string[]; celulas: EscalaCelulaEntrada[] } {
  const nomes: string[] = [];
  const celulas: EscalaCelulaEntrada[] = [];
  const limite = proximoAnchorLinha ?? worksheet.rowCount + 1;

  for (let linha = anchor.linhaData + 2; linha < limite; linha++) {
    const row = worksheet.getRow(linha);
    const nomeBruto = getCellRawString(row.getCell(1));

    if (nomeBruto === "") break;
    if (ehLinhaDeCobertura(nomeBruto)) break;

    nomes.push(nomeBruto);

    for (let k = 0; k < anchor.datas.length; k++) {
      const data = anchor.datas[k];
      if (data.getUTCFullYear() !== ano || data.getUTCMonth() + 1 !== mes) continue;

      const valor = getCellRawString(row.getCell(anchor.colunaInicial + k));
      if (valor === "") continue;

      celulas.push({ nome_planilha: nomeBruto, data: dataParaISO(data), valor });
    }
  }

  return { nomes, celulas };
}

export function buildImportPayload(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  ano: number,
  mes: number,
): EscalaImportPayload {
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) return { funcionariosPlanilha: [], entradas: [] };

  const anchors = encontrarAnchorsDeBloco(worksheet);
  const nomesSet = new Set<string>();
  const entradas: EscalaCelulaEntrada[] = [];

  anchors.forEach((anchor, index) => {
    const proximoAnchorLinha = anchors[index + 1]?.linhaData ?? null;
    const { nomes, celulas } = extrairBloco(worksheet, anchor, proximoAnchorLinha, ano, mes);
    for (const nome of nomes) nomesSet.add(nome);
    entradas.push(...celulas);
  });

  return { funcionariosPlanilha: Array.from(nomesSet), entradas };
}

export async function readWorkbookFromFile(file: File): Promise<ExcelJS.Workbook> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}
