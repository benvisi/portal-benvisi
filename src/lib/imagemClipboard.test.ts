import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buscarImagemPng,
  compartilharImagem,
  compartilhamentoSuportado,
  copiarImagem,
  copiaImagemSuportada,
  criarArquivoPng,
} from "@/lib/imagemClipboard";

afterEach(() => vi.unstubAllGlobals());

const resposta = (type: string, ok = true) =>
  ({ ok, status: ok ? 200 : 404, blob: async () => new Blob(["x"], { type }) }) as Response;

describe("buscarImagemPng", () => {
  it("converts a WebP download to PNG", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const converter = vi.fn(async () => png);
    const fetchFn = vi.fn(async () => resposta("image/webp"));
    expect(await buscarImagemPng("u", fetchFn as never, converter)).toBe(png);
    expect(converter).toHaveBeenCalledTimes(1);
  });

  it("keeps an image that is already PNG", async () => {
    const converter = vi.fn();
    const fetchFn = vi.fn(async () => resposta("image/png"));
    const blob = await buscarImagemPng("u", fetchFn as never, converter);
    expect(blob.type).toBe("image/png");
    expect(converter).not.toHaveBeenCalled();
  });

  it("rejects on a failed download", async () => {
    const fetchFn = vi.fn(async () => resposta("", false));
    await expect(buscarImagemPng("u", fetchFn as never, vi.fn())).rejects.toThrow("HTTP 404");
  });
});

describe("copiarImagem", () => {
  it("reports unsupported when ClipboardItem is missing", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    expect(copiaImagemSuportada()).toBe(false);
    expect(await copiarImagem(Promise.resolve(new Blob()))).toBe("nao-suportado");
  });
});

describe("compartilharImagem", () => {
  const arquivo = criarArquivoPng(new Blob(["x"], { type: "image/png" }), "46SMA0045BR-02H");

  it("builds a PNG file", () => {
    expect(arquivo.name).toBe("46SMA0045BR-02H.png");
    expect(arquivo.type).toBe("image/png");
  });

  it("is unsupported without Web Share file support", async () => {
    vi.stubGlobal("navigator", { share: undefined });
    expect(compartilhamentoSuportado(arquivo)).toBe(false);
    expect(await compartilharImagem(arquivo, "t")).toBe("nao-suportado");

    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
    expect(await compartilharImagem(arquivo, "t")).toBe("nao-suportado");
  });

  it("shares the file and maps cancel vs failure", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });
    expect(await compartilharImagem(arquivo, "t")).toBe("ok");
    expect(share).toHaveBeenCalledWith({ files: [arquivo], title: "t" });

    share.mockRejectedValueOnce(new DOMException("c", "AbortError"));
    expect(await compartilharImagem(arquivo, "t")).toBe("cancelado");
    share.mockRejectedValueOnce(new Error("boom"));
    expect(await compartilharImagem(arquivo, "t")).toBe("falhou");
  });
});
