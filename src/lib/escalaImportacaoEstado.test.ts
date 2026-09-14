import { describe, expect, it } from "vitest";

import { possuiAlteracoesParaPublicar } from "@/lib/escalaImportacaoEstado";

describe("possuiAlteracoesParaPublicar", () => {
  it("blocks publication for an existing active month with zero diff", () => {
    expect(possuiAlteracoesParaPublicar({ is_revisao: true, diff: [] })).toBe(false);
  });

  it("allows publication for an existing active month with 1+ changes", () => {
    expect(possuiAlteracoesParaPublicar({ is_revisao: true, diff: [{}] })).toBe(true);
  });

  it("allows publication for a new month with no active publication", () => {
    expect(possuiAlteracoesParaPublicar({ is_revisao: false, diff: [] })).toBe(true);
  });

  it("allows publication when is_revisao is unknown (e.g. a blocked result)", () => {
    expect(possuiAlteracoesParaPublicar({ is_revisao: null, diff: [] })).toBe(true);
  });
});
