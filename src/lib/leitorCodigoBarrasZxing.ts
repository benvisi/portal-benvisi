// zxing-wasm fallback decoder. Only ever reached through the dynamic import in
// leitorCodigoBarras.ts, so this module, the zxing JS glue and the .wasm file
// are separate chunks fetched the first time the camera opens on a browser
// without a usable native BarcodeDetector (iOS/iPadOS, Firefox).
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

import type { LeitorCodigoBarras } from "@/lib/leitorCodigoBarras";

const OPCOES: ReaderOptions = {
  formats: ["EAN13", "EAN8", "Code128", "Code39", "ITF"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  maxNumberOfSymbols: 1,
};

// Longest edge of the frame handed to the decoder: enough for a tag barcode
// filling part of the view, small enough to keep each pass fast on phones.
const LADO_MAXIMO = 960;

let preparado: Promise<unknown> | null = null;

function prepararModulo(): Promise<unknown> {
  // Serve the .wasm from our own origin (the library default is jsDelivr).
  preparado ??= prepareZXingModule({
    overrides: {
      locateFile: (caminho: string, prefixo: string) =>
        caminho.endsWith(".wasm") ? wasmUrl : prefixo + caminho,
    },
    fireImmediately: true,
  });
  return preparado;
}

export async function criarLeitorZxing(): Promise<LeitorCodigoBarras> {
  await prepararModulo();
  const canvas = document.createElement("canvas");
  const contexto = canvas.getContext("2d", { willReadFrequently: true });
  if (!contexto) throw new Error("CANVAS_INDISPONIVEL");

  return {
    motor: "zxing",
    async ler(video) {
      const largura = video.videoWidth;
      const altura = video.videoHeight;
      if (video.readyState < 2 || largura === 0 || altura === 0) return null;
      const escala = Math.min(1, LADO_MAXIMO / Math.max(largura, altura));
      canvas.width = Math.round(largura * escala);
      canvas.height = Math.round(altura * escala);
      contexto.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imagem = contexto.getImageData(0, 0, canvas.width, canvas.height);
      const resultados = await readBarcodes(imagem, OPCOES);
      for (const r of resultados) {
        const texto = r.isValid ? r.text.trim() : "";
        if (texto.length > 0) return texto;
      }
      return null;
    },
  };
}
