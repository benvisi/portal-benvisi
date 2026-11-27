import { afterEach, describe, expect, it, vi } from "vitest";

const criarLeitorZxing = vi.fn(async () => ({ motor: "zxing" as const, ler: async () => null }));
vi.mock("@/lib/leitorCodigoBarrasZxing", () => ({ criarLeitorZxing }));

import { classificarErroCamera, criarLeitorCodigoBarras } from "@/lib/leitorCodigoBarras";

type G = { BarcodeDetector?: unknown };

afterEach(() => {
  delete (globalThis as G).BarcodeDetector;
  criarLeitorZxing.mockClear();
});

function detectorNativo(suportados: string[], valor = "0012345678905") {
  const construidoCom: unknown[] = [];
  class FakeDetector {
    static getSupportedFormats = async () => suportados;
    constructor(opts: unknown) {
      construidoCom.push(opts);
    }
    async detect() {
      return [{ rawValue: valor }];
    }
  }
  (globalThis as G).BarcodeDetector = FakeDetector;
  return construidoCom;
}

describe("criarLeitorCodigoBarras", () => {
  it("uses the native BarcodeDetector when it supports our formats (no zxing load)", async () => {
    const construido = detectorNativo(["qr_code", "ean_13", "code_128"]);
    const leitor = await criarLeitorCodigoBarras();
    expect(leitor.motor).toBe("nativo");
    expect(construido[0]).toEqual({ formats: ["ean_13", "code_128"] });
    expect(criarLeitorZxing).not.toHaveBeenCalled();
    const video = { readyState: 4 } as HTMLVideoElement;
    expect(await leitor.ler(video)).toBe("0012345678905");
  });

  it("falls back to zxing-wasm when BarcodeDetector is missing (iOS/Firefox)", async () => {
    const leitor = await criarLeitorCodigoBarras();
    expect(leitor.motor).toBe("zxing");
    expect(criarLeitorZxing).toHaveBeenCalledOnce();
  });

  it("falls back to zxing-wasm when the native detector supports none of our formats", async () => {
    detectorNativo(["qr_code"]);
    const leitor = await criarLeitorCodigoBarras();
    expect(leitor.motor).toBe("zxing");
  });
});

describe("classificarErroCamera", () => {
  it.each([
    ["NotAllowedError", "permissao_negada"],
    ["SecurityError", "permissao_negada"],
    ["NotFoundError", "sem_camera"],
    ["OverconstrainedError", "sem_camera"],
    ["NotSupportedError", "nao_suportado"],
    ["NotReadableError", "falha"],
  ])("%s -> %s", (name, esperado) => {
    expect(classificarErroCamera({ name })).toBe(esperado);
  });
});
