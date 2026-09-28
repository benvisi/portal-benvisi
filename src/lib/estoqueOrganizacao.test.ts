import { describe, expect, it } from "vitest";

import {
  addWeeksISO,
  formatSemanaLabel,
  getEstoqueOrganizacaoManualErrorMessage,
  getEstoqueOrganizacaoProgressoErrorMessage,
  weekStartISO,
} from "@/lib/estoqueOrganizacao";

describe("weekStartISO", () => {
  it("returns the same date when it is already a Sunday", () => {
    // 2026-09-27 is a Sunday.
    expect(weekStartISO("2026-09-27")).toBe("2026-09-27");
  });

  it("returns the preceding Sunday for a mid-week date", () => {
    // 2026-09-30 is a Wednesday in that same week.
    expect(weekStartISO("2026-09-30")).toBe("2026-09-27");
  });

  it("returns the preceding Sunday for a Saturday (end of week)", () => {
    // 2026-10-03 is the Saturday closing the week starting 2026-09-27.
    expect(weekStartISO("2026-10-03")).toBe("2026-09-27");
  });

  it("crosses a month boundary correctly", () => {
    // 2026-10-01 (Thursday) belongs to the week starting Sunday 2026-09-27.
    expect(weekStartISO("2026-10-01")).toBe("2026-09-27");
  });
});

describe("addWeeksISO", () => {
  it("advances by whole weeks, preserving the day of week", () => {
    expect(addWeeksISO("2026-09-27", 1)).toBe("2026-10-04");
    expect(addWeeksISO("2026-09-27", -1)).toBe("2026-09-20");
  });
});

describe("formatSemanaLabel", () => {
  it("formats the Sunday-Saturday range for a week", () => {
    expect(formatSemanaLabel("2026-09-27")).toBe("27/09 – 03/10");
  });
});

describe("getEstoqueOrganizacaoProgressoErrorMessage", () => {
  it("maps a known RPC error code", () => {
    expect(getEstoqueOrganizacaoProgressoErrorMessage({ message: "SEMANA_ENCERRADA" })).toContain(
      "encerrada",
    );
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(getEstoqueOrganizacaoProgressoErrorMessage({ message: "SOMETHING_ELSE" })).toBe(
      "Não foi possível salvar o progresso agora. Tente novamente.",
    );
    expect(getEstoqueOrganizacaoProgressoErrorMessage(new Error("network down"))).toBe(
      "Não foi possível salvar o progresso agora. Tente novamente.",
    );
  });
});

describe("getEstoqueOrganizacaoManualErrorMessage", () => {
  it("maps a known RPC error code", () => {
    expect(
      getEstoqueOrganizacaoManualErrorMessage({ message: "SEM_PERMISSAO_ESTOQUE_ORGANIZACAO" }),
    ).toContain("permissão");
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(getEstoqueOrganizacaoManualErrorMessage({ message: "SOMETHING_ELSE" })).toBe(
      "Não foi possível sincronizar agora. Tente novamente.",
    );
  });
});
