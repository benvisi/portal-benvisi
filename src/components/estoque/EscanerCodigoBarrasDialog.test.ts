// @vitest-environment jsdom
// Scanner lifecycle with a fake camera stream and a fake decoder (no real
// camera or wasm in jsdom).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import EscanerCodigoBarrasDialog, {
  type EscanerCodigoBarrasDialogProps,
} from "@/components/estoque/EscanerCodigoBarrasDialog";
import type { LeitorCodigoBarras } from "@/lib/leitorCodigoBarras";

beforeAll(() => {
  // jsdom has no media playback.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    writable: true,
    value: null,
  });
});

afterEach(cleanup);

function fakeStream() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function leitorQueLe(...leituras: (string | null | Error)[]): LeitorCodigoBarras {
  let i = 0;
  return {
    motor: "nativo",
    ler: vi.fn(async () => {
      const r = leituras[Math.min(i++, leituras.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }),
  };
}

function montar(over: Partial<EscanerCodigoBarrasDialogProps> = {}) {
  const props: EscanerCodigoBarrasDialogProps = {
    onDetectado: vi.fn(),
    onFechar: vi.fn(),
    onDigitar: vi.fn(),
    cameraDisponivel: () => true,
    criarLeitor: async () => leitorQueLe("0012345678905"),
    ...over,
  };
  const r = render(createElement(EscanerCodigoBarrasDialog, props));
  return { ...r, props };
}

function erroNomeado(name: string) {
  return Object.assign(new Error(name), { name });
}

describe("EscanerCodigoBarrasDialog", () => {
  it("prefers the rear camera and stops it on a successful read, delivering once", async () => {
    const { stream, track } = fakeStream();
    const obterStream = vi.fn(async (_c: MediaStreamConstraints) => stream);
    const { props } = montar({
      obterStream,
      criarLeitor: async () => leitorQueLe(null, "0012345678905", "0012345678905"),
    });
    await waitFor(() => expect(props.onDetectado).toHaveBeenCalled());
    const constraints = obterStream.mock.calls[0][0];
    expect((constraints.video as MediaTrackConstraints).facingMode).toEqual({
      ideal: "environment",
    });
    expect(props.onDetectado).toHaveBeenCalledTimes(1);
    expect(props.onDetectado).toHaveBeenCalledWith("0012345678905");
    expect(track.stop).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 300));
    expect(props.onDetectado).toHaveBeenCalledTimes(1);
  });

  it("Cancelar stops the camera and closes", async () => {
    const { stream, track } = fakeStream();
    const { props } = montar({
      obterStream: async () => stream,
      criarLeitor: async () => leitorQueLe(null),
    });
    await waitFor(() => expect(screen.queryByText("Abrindo a câmera...")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(track.stop).toHaveBeenCalled();
    expect(props.onFechar).toHaveBeenCalled();
    expect(props.onDetectado).not.toHaveBeenCalled();
  });

  it("Digitar código stops the camera and hands over to manual entry", async () => {
    const { stream, track } = fakeStream();
    const { props } = montar({
      obterStream: async () => stream,
      criarLeitor: async () => leitorQueLe(null),
    });
    await waitFor(() => expect(screen.queryByText("Abrindo a câmera...")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Digitar código" }));
    expect(track.stop).toHaveBeenCalled();
    expect(props.onDigitar).toHaveBeenCalled();
  });

  it("unmount (navigation) stops the camera", async () => {
    const { stream, track } = fakeStream();
    const { unmount } = montar({
      obterStream: async () => stream,
      criarLeitor: async () => leitorQueLe(null),
    });
    await waitFor(() => expect(screen.queryByText("Abrindo a câmera...")).toBeNull());
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("a camera grant that arrives after closing is stopped immediately", async () => {
    const { stream, track } = fakeStream();
    let liberar: (s: MediaStream) => void = () => {};
    const { unmount } = montar({
      obterStream: () => new Promise<MediaStream>((r) => (liberar = r)),
    });
    unmount();
    await act(async () => liberar(stream));
    expect(track.stop).toHaveBeenCalled();
  });

  it("page hidden stops the camera and closes", async () => {
    const { stream, track } = fakeStream();
    const { props } = montar({
      obterStream: async () => stream,
      criarLeitor: async () => leitorQueLe(null),
    });
    await waitFor(() => expect(screen.queryByText("Abrindo a câmera...")).toBeNull());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(track.stop).toHaveBeenCalled();
    expect(props.onFechar).toHaveBeenCalled();
  });

  it.each([
    ["NotAllowedError", "Permissão da câmera negada"],
    ["NotFoundError", "Nenhuma câmera encontrada"],
    ["OverconstrainedError", "Nenhuma câmera encontrada"],
    ["AbortError", "Não foi possível usar a câmera agora"],
  ])("getUserMedia %s shows a pt-BR message", async (nome, texto) => {
    montar({ obterStream: async () => Promise.reject(erroNomeado(nome)) });
    expect((await screen.findByRole("alert")).textContent).toContain(texto);
    expect(screen.getByRole("button", { name: "Digitar código" })).toBeTruthy();
  });

  it("unsupported browser (no getUserMedia) offers manual entry without asking for the camera", async () => {
    const obterStream = vi.fn();
    montar({ cameraDisponivel: () => false, obterStream });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Este navegador não permite ler códigos",
    );
    expect(obterStream).not.toHaveBeenCalled();
  });

  it("decoder that cannot initialise stops the camera and reports unsupported", async () => {
    const { stream, track } = fakeStream();
    montar({
      obterStream: async () => stream,
      criarLeitor: () => Promise.reject(new Error("wasm")),
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Este navegador não permite ler códigos",
    );
    expect(track.stop).toHaveBeenCalled();
  });

  it("repeated decoding errors stop the camera, then Tentar novamente restarts it", async () => {
    const primeiro = fakeStream();
    const segundo = fakeStream();
    const obterStream = vi
      .fn()
      .mockResolvedValueOnce(primeiro.stream)
      .mockResolvedValueOnce(segundo.stream);
    const { props } = montar({
      obterStream,
      criarLeitor: vi
        .fn()
        .mockResolvedValueOnce(leitorQueLe(new Error("decode")))
        .mockResolvedValueOnce(leitorQueLe("7891234567895")),
    });
    expect((await screen.findByRole("alert", {}, { timeout: 3000 })).textContent).toContain(
      "Não foi possível ler o código",
    );
    expect(primeiro.track.stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(props.onDetectado).toHaveBeenCalledWith("7891234567895"));
    expect(segundo.track.stop).toHaveBeenCalled();
  });
});
