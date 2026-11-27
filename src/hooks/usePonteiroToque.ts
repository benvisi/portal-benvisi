import { useSyncExternalStore } from "react";

const CONSULTA = "(pointer: coarse)";

function assinar(aoMudar: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(CONSULTA);
  mql.addEventListener("change", aoMudar);
  return () => mql.removeEventListener("change", aoMudar);
}

function ler(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(CONSULTA).matches;
}

/**
 * True on phones and tablets (primary pointer is a finger), false on desktop
 * and during SSR. Barcode Slice 2 uses it to show the camera scan control on
 * mobile/tablet only; desktop uses the keyboard or a USB scanner.
 */
export function usePonteiroToque(): boolean {
  return useSyncExternalStore(assinar, ler, () => false);
}
