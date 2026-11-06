// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProdutoImagemViewer } from "@/components/estoque/ProdutoImagemViewer";
import type { ImagensDaCor } from "@/lib/produtoImagensPublicadas";

vi.mock("@/lib/imagemClipboard", async () => ({
  ...(await vi.importActual<typeof import("@/lib/imagemClipboard")>("@/lib/imagemClipboard")),
  buscarImagemPng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

const clipboardWrite = vi.fn();
const share = vi.fn();
const canShare = vi.fn();

class FakeClipboardItem {
  constructor(public items: Record<string, unknown>) {}
}

function setBrowser({ clipboard = true, sharing = false } = {}) {
  vi.stubGlobal("ClipboardItem", clipboard ? FakeClipboardItem : undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard ? { write: clipboardWrite } : undefined,
    configurable: true,
  });
  Object.defineProperty(navigator, "share", {
    value: sharing ? share : undefined,
    configurable: true,
  });
  Object.defineProperty(navigator, "canShare", {
    value: sharing ? canShare : undefined,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const DUAS: ImagensDaCor = {
  principal: "https://cdn.test/p.webp",
  secundaria: "https://cdn.test/s.webp",
};

function renderViewer(imagens: ImagensDaCor = DUAS, onClose = vi.fn()) {
  return render(
    createElement(ProdutoImagemViewer, {
      produto: "46SMA0045BR",
      corCodigo: "02H",
      imagens,
      onClose,
    }),
  );
}

const src = () => (screen.getByRole("img") as HTMLImageElement).src;
const loaded = () => fireEvent.load(screen.getByRole("img"));
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const queryButton = (name: string) => screen.queryByRole("button", { name });

describe("navigation arrows", () => {
  it("moves between images, wrapping, without closing the dialog", () => {
    const onClose = vi.fn();
    renderViewer(DUAS, onClose);
    click("Próxima imagem");
    expect(src()).toBe("https://cdn.test/s.webp");
    click("Próxima imagem");
    expect(src()).toBe("https://cdn.test/p.webp");
    click("Imagem anterior");
    expect(src()).toBe("https://cdn.test/s.webp");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the Principal/Secundária buttons in sync", () => {
    renderViewer();
    click("Próxima imagem");
    expect(screen.getByRole("button", { name: "Secundária" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("shows no arrows with a single image", () => {
    renderViewer({ principal: "https://cdn.test/p.webp", secundaria: null });
    expect(queryButton("Próxima imagem")).toBeNull();
    expect(queryButton("Imagem anterior")).toBeNull();
  });
});

describe("copy and share", () => {
  it("offers copy only once the image has loaded", () => {
    setBrowser();
    renderViewer();
    expect(queryButton("Copiar imagem")).toBeNull();
    loaded();
    expect(queryButton("Copiar imagem")).not.toBeNull();
  });

  it("copies PNG image data and confirms only after the clipboard succeeds", async () => {
    setBrowser();
    let resolveWrite: () => void = () => {};
    clipboardWrite.mockReturnValue(new Promise<void>((r) => (resolveWrite = r)));
    renderViewer();
    loaded();
    click("Copiar imagem");

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    const item = clipboardWrite.mock.calls[0][0][0] as FakeClipboardItem;
    expect(Object.keys(item.items)).toEqual(["image/png"]);
    expect(screen.queryByText("Imagem copiada.")).toBeNull();

    resolveWrite();
    expect(await screen.findByText("Imagem copiada.")).toBeTruthy();
    expect(queryButton("Compartilhar imagem")).toBeNull();
  });

  it("reports failure and shares the image file as a fallback", async () => {
    setBrowser({ sharing: true });
    clipboardWrite.mockRejectedValue(new Error("NotAllowedError"));
    canShare.mockReturnValue(true);
    share.mockResolvedValue(undefined);
    renderViewer();
    loaded();
    click("Copiar imagem");

    expect(await screen.findByText("Não foi possível copiar a imagem.")).toBeTruthy();
    expect(screen.queryByText("Imagem copiada.")).toBeNull();

    click("Compartilhar imagem");
    expect(await screen.findByText("Imagem compartilhada.")).toBeTruthy();
    const dados = share.mock.calls[0][0] as { files: File[]; url?: string };
    expect(dados.files).toHaveLength(1);
    expect(dados.files[0].type).toBe("image/png");
    expect(dados.url).toBeUndefined();
  });

  it("offers sharing when the Clipboard API is unsupported", async () => {
    setBrowser({ clipboard: false, sharing: true });
    canShare.mockReturnValue(true);
    renderViewer();
    loaded();
    click("Copiar imagem");
    expect(await screen.findByText("Não foi possível copiar a imagem.")).toBeTruthy();
    expect(queryButton("Compartilhar imagem")).not.toBeNull();
  });

  it("offers no share fallback when files cannot be shared", async () => {
    setBrowser({ sharing: false });
    clipboardWrite.mockRejectedValue(new Error("fail"));
    renderViewer();
    loaded();
    click("Copiar imagem");
    expect(await screen.findByText("Não foi possível copiar a imagem.")).toBeTruthy();
    expect(queryButton("Compartilhar imagem")).toBeNull();
  });

  it("shows no error when the user cancels the share sheet", async () => {
    setBrowser({ clipboard: false, sharing: true });
    canShare.mockReturnValue(true);
    share.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    renderViewer();
    loaded();
    click("Copiar imagem");
    await screen.findByText("Não foi possível copiar a imagem.");
    click("Compartilhar imagem");
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByText("Não foi possível compartilhar a imagem.")).toBeNull();
  });
});
