/**
 * Barcode Slice 2 — camera barcode decoding engine.
 *
 * Preference order:
 *   1. Native BarcodeDetector (Shape Detection API) when the browser exposes
 *      it AND reports at least one of our retail formats (Chrome/Edge on
 *      Android, Samsung Internet). Zero download.
 *   2. zxing-wasm (reader build), loaded with a dynamic import ONLY when the
 *      camera is opened on a browser without a usable native detector —
 *      notably every iOS/iPadOS browser (WebKit has no BarcodeDetector) and
 *      Firefox. The .wasm binary is bundled and served from our own origin
 *      (never the library's default jsDelivr CDN).
 *
 * Nothing here is imported by the ordinary search path: the scanner dialog
 * that uses it is itself lazy-loaded, so inventory searches never pay for it.
 */

/** Linear retail/industrial formats found on clothing tags and boxes. */
export const FORMATOS_NATIVOS = ["ean_13", "ean_8", "code_128", "code_39", "itf"] as const;

export interface LeitorCodigoBarras {
  /** Decodes one video frame; resolves the barcode text or null. */
  ler(video: HTMLVideoElement): Promise<string | null>;
  readonly motor: "nativo" | "zxing";
}

interface DetectedBarcodeLike {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorCtorLike {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function obterBarcodeDetectorNativo(): BarcodeDetectorCtorLike | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtorLike }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

function primeiroValor(resultados: readonly { text?: string; rawValue?: string }[]): string | null {
  for (const r of resultados) {
    // Keep the decoded text exactly (leading zeros included); only trim.
    const valor = (r.rawValue ?? r.text ?? "").trim();
    if (valor.length > 0) return valor;
  }
  return null;
}

async function criarLeitorNativo(): Promise<LeitorCodigoBarras | null> {
  const Ctor = obterBarcodeDetectorNativo();
  if (!Ctor) return null;
  let formatos: string[] = [...FORMATOS_NATIVOS];
  try {
    if (Ctor.getSupportedFormats) {
      const suportados = await Ctor.getSupportedFormats();
      formatos = formatos.filter((f) => suportados.includes(f));
    }
  } catch {
    return null;
  }
  if (formatos.length === 0) return null;
  let detector: BarcodeDetectorLike;
  try {
    detector = new Ctor({ formats: formatos });
  } catch {
    return null;
  }
  return {
    motor: "nativo",
    async ler(video) {
      if (video.readyState < 2) return null;
      return primeiroValor(await detector.detect(video));
    },
  };
}

/**
 * Creates the best available decoder. Throws only when neither engine can be
 * initialised (the dialog then shows the "navegador não suportado" state).
 */
export async function criarLeitorCodigoBarras(): Promise<LeitorCodigoBarras> {
  const nativo = await criarLeitorNativo();
  if (nativo) return nativo;
  const { criarLeitorZxing } = await import("@/lib/leitorCodigoBarrasZxing");
  return criarLeitorZxing();
}

/** getUserMedia failure -> the camera state shown to the employee. */
export type ErroCamera = "permissao_negada" | "sem_camera" | "nao_suportado" | "falha";

export function classificarErroCamera(error: unknown): ErroCamera {
  const nome =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  switch (nome) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "permissao_negada";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "sem_camera";
    case "NotSupportedError":
    case "TypeError":
      return "nao_suportado";
    default:
      return "falha";
  }
}

export function cameraDisponivelNoNavegador(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    // getUserMedia only exists on secure origins; guard anyway.
    (typeof window === "undefined" || window.isSecureContext !== false)
  );
}

/** Rear camera preferred; front/any camera still accepted as a fallback. */
export const RESTRICOES_CAMERA: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export function pararStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
