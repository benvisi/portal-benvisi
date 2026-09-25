import { describe, expect, it } from "vitest";

import {
  formatLimpezaHora,
  getLimpezaConcluirErrorMessage,
  getLimpezaManualErrorMessage,
  LIMPEZA_TAREFA_ORDEM,
  LIMPEZA_TURNO_ORDEM,
} from "@/lib/limpeza";

describe("formatLimpezaHora", () => {
  it("formats an ISO instant as Manaus HH:mm", () => {
    // 14:18 UTC = 10:18 in America/Manaus (UTC-4).
    expect(formatLimpezaHora("2026-09-25T14:18:00Z")).toBe("10:18");
  });
});

describe("getLimpezaConcluirErrorMessage", () => {
  it("maps a known RPC error code", () => {
    expect(getLimpezaConcluirErrorMessage({ message: "ATRIBUICAO_EM_CONFLITO" })).toContain(
      "conflito",
    );
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(getLimpezaConcluirErrorMessage({ message: "SOMETHING_ELSE" })).toBe(
      "Não foi possível concluir agora. Tente novamente.",
    );
    expect(getLimpezaConcluirErrorMessage(new Error("network down"))).toBe(
      "Não foi possível concluir agora. Tente novamente.",
    );
  });
});

describe("getLimpezaManualErrorMessage", () => {
  it("maps a known RPC error code", () => {
    expect(getLimpezaManualErrorMessage({ message: "FUNCIONARIO_INDISPONIVEL" })).toContain(
      "escalado",
    );
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(getLimpezaManualErrorMessage({ message: "SOMETHING_ELSE" })).toBe(
      "Não foi possível salvar a alteração. Tente novamente.",
    );
  });
});

describe("display order constants", () => {
  it("orders manhã before tarde, varrer before passar pano", () => {
    expect(LIMPEZA_TURNO_ORDEM).toEqual(["manha", "tarde"]);
    expect(LIMPEZA_TAREFA_ORDEM).toEqual(["varrer", "passar_pano"]);
  });
});
