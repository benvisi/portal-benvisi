/**
 * Small accessibility MVP: a user-controlled larger-text preference.
 *
 * This is a device/browser presentation preference, not employee-account
 * data — stored in localStorage only, never sent to Supabase, and never
 * read by any backend RPC. Applying it is purely a `data-text-size`
 * attribute toggle on `<html>`; the actual size values live in
 * `src/styles.css` as a small `--text-*` custom-property override scoped to
 * `html[data-text-size="large"]`, so every component using Tailwind's
 * ordinary `text-*` utilities picks up the larger scale automatically —
 * nothing here or in any component needs an `if (largerText) ... else ...`
 * branch.
 */

export type TextSizePreference = "padrao" | "grande";

export const TEXT_SIZE_STORAGE_KEY = "benvisi.texto-maior";
export const TEXT_SIZE_ATTRIBUTE = "data-text-size";
export const TEXT_SIZE_LARGE_VALUE = "grande";

export function getStoredTextSizePreference(): TextSizePreference {
  try {
    return localStorage.getItem(TEXT_SIZE_STORAGE_KEY) === TEXT_SIZE_LARGE_VALUE
      ? "grande"
      : "padrao";
  } catch {
    // Storage unavailable (private browsing, disabled storage, etc.) —
    // silently fall back to the default size rather than failing the page.
    return "padrao";
  }
}

export function applyTextSizePreference(preference: TextSizePreference): void {
  const root = document.documentElement;
  if (preference === "grande") {
    root.setAttribute(TEXT_SIZE_ATTRIBUTE, TEXT_SIZE_LARGE_VALUE);
  } else {
    root.removeAttribute(TEXT_SIZE_ATTRIBUTE);
  }
}

export function setTextSizePreference(preference: TextSizePreference): void {
  try {
    if (preference === "grande") {
      localStorage.setItem(TEXT_SIZE_STORAGE_KEY, TEXT_SIZE_LARGE_VALUE);
    } else {
      localStorage.removeItem(TEXT_SIZE_STORAGE_KEY);
    }
  } catch {
    // Same as above — the preference just won't survive a reload; it still
    // applies for the current page via applyTextSizePreference below.
  }
  applyTextSizePreference(preference);
}

/**
 * A tiny, deliberately hand-written, self-contained inline script — not a
 * bundled module — injected as the very first element of `<head>`
 * (`__root.tsx`) so it runs synchronously before first paint. This is the
 * standard minimal-footprint fix for the "server-rendered HTML can't know
 * a client-only localStorage preference" flash problem (the same pattern
 * used for dark-mode-before-hydration), not new SSR/hydration
 * infrastructure — it only ever sets one attribute, and only when the
 * stored preference is "grande" (the non-default case; a fresh browser
 * with no stored preference needs to do nothing, matching the CSS default).
 * The storage key/attribute/value strings are interpolated from the single
 * source of truth above rather than duplicated as separate literals.
 */
export const TEXT_SIZE_INLINE_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  TEXT_SIZE_STORAGE_KEY,
)})===${JSON.stringify(TEXT_SIZE_LARGE_VALUE)}){document.documentElement.setAttribute(${JSON.stringify(
  TEXT_SIZE_ATTRIBUTE,
)},${JSON.stringify(TEXT_SIZE_LARGE_VALUE)})}}catch(e){}})();`;
