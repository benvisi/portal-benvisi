/**
 * Small accessibility MVP: a user-controlled text-size preference, now with
 * three steps (Padrão / Maior / Extra grande).
 *
 * This is a device/browser presentation preference, not employee-account
 * data — stored in localStorage only, never sent to Supabase, and never
 * read by any backend RPC. Applying it is purely a `data-text-size`
 * attribute toggle on `<html>`; the actual size values live in
 * `src/styles.css` as small `--text-*` custom-property overrides scoped to
 * `html[data-text-size="grande"]` / `html[data-text-size="extra"]`, so every
 * component using Tailwind's ordinary `text-*` utilities picks up the
 * larger scale automatically — nothing here or in any component needs an
 * `if (largerText) ... else ...` branch.
 *
 * The stored/attribute value for the middle tier is still the literal
 * string "grande" — that is the pre-existing "Texto Maior" value, kept
 * unchanged (just relabeled "Maior" in the UI) so an employee who already
 * chose it does not get a different size just because a third option was
 * added, and no migration of existing localStorage values is needed.
 */

export type TextSizePreference = "padrao" | "grande" | "extra";

export const TEXT_SIZE_STORAGE_KEY = "benvisi.texto-maior";
export const TEXT_SIZE_ATTRIBUTE = "data-text-size";
export const TEXT_SIZE_LARGE_VALUE = "grande";
export const TEXT_SIZE_EXTRA_VALUE = "extra";

export function getStoredTextSizePreference(): TextSizePreference {
  try {
    const stored = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    if (stored === TEXT_SIZE_EXTRA_VALUE) return "extra";
    if (stored === TEXT_SIZE_LARGE_VALUE) return "grande";
    return "padrao";
  } catch {
    // Storage unavailable (private browsing, disabled storage, etc.) —
    // silently fall back to the default size rather than failing the page.
    return "padrao";
  }
}

export function applyTextSizePreference(preference: TextSizePreference): void {
  const root = document.documentElement;
  if (preference === "padrao") {
    root.removeAttribute(TEXT_SIZE_ATTRIBUTE);
  } else {
    root.setAttribute(TEXT_SIZE_ATTRIBUTE, preference);
  }
}

export function setTextSizePreference(preference: TextSizePreference): void {
  try {
    if (preference === "padrao") {
      localStorage.removeItem(TEXT_SIZE_STORAGE_KEY);
    } else {
      localStorage.setItem(TEXT_SIZE_STORAGE_KEY, preference);
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
 * infrastructure — it only ever sets one attribute, and only for the two
 * non-default values (a fresh browser with no stored preference needs to
 * do nothing, matching the CSS default).
 * The storage key/attribute/value strings are interpolated from the single
 * source of truth above rather than duplicated as separate literals.
 */
export const TEXT_SIZE_INLINE_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  TEXT_SIZE_STORAGE_KEY,
)});if(v===${JSON.stringify(TEXT_SIZE_LARGE_VALUE)}||v===${JSON.stringify(
  TEXT_SIZE_EXTRA_VALUE,
)}){document.documentElement.setAttribute(${JSON.stringify(TEXT_SIZE_ATTRIBUTE)},v)}}catch(e){}})();`;
