// Copy / share a published product image as image data (never its URL).
//
// iPhone Safari notes:
//  - navigator.clipboard.write accepts only image/png for images (no WebP), so
//    the published WebP is converted to PNG with a canvas.
//  - Safari requires the write to start inside the tap handler. Passing a
//    *promise* of the blob to ClipboardItem keeps the user activation while the
//    image is fetched and converted.
//  - navigator.share with files needs a tap too and works only for file types
//    the platform accepts; it is the fallback when copying is unavailable.

export type ResultadoCopia = "ok" | "nao-suportado" | "falhou";
export type ResultadoCompartilhamento = "ok" | "cancelado" | "nao-suportado" | "falhou";

const PNG = "image/png";

/** Draws the blob on a canvas and exports it as PNG. */
export async function converterParaPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas indisponível");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("png vazio"))), PNG),
    );
  } finally {
    bitmap.close();
  }
}

/** Downloads the image and returns it as a PNG blob. */
export async function buscarImagemPng(
  url: string,
  fetchFn: typeof fetch = fetch,
  converter: (blob: Blob) => Promise<Blob> = converterParaPng,
): Promise<Blob> {
  const resposta = await fetchFn(url);
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const blob = await resposta.blob();
  return blob.type === PNG ? blob : converter(blob);
}

export function copiaImagemSuportada(): boolean {
  return (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

/**
 * Copies the image. Must be called synchronously from the tap handler, with a
 * promise (not an awaited blob), so Safari keeps the user activation.
 */
export async function copiarImagem(png: Promise<Blob>): Promise<ResultadoCopia> {
  if (!copiaImagemSuportada()) return "nao-suportado";
  try {
    await navigator.clipboard.write([new ClipboardItem({ [PNG]: png })]);
    return "ok";
  } catch {
    return "falhou";
  }
}

export function criarArquivoPng(png: Blob, nome: string): File {
  return new File([png], `${nome}.png`, { type: PNG });
}

/** True when the browser can share this image file with the native sheet. */
export function compartilhamentoSuportado(arquivo?: File): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return false;
  return arquivo ? navigator.canShare({ files: [arquivo] }) : true;
}

/** Shares the image file (not a URL) through the native share sheet. */
export async function compartilharImagem(
  arquivo: File,
  titulo: string,
): Promise<ResultadoCompartilhamento> {
  if (!compartilhamentoSuportado(arquivo)) return "nao-suportado";
  try {
    await navigator.share({ files: [arquivo], title: titulo });
    return "ok";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "cancelado" : "falhou";
  }
}
