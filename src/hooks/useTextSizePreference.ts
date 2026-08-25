import { useCallback, useState } from "react";

import {
  getStoredTextSizePreference,
  setTextSizePreference,
  type TextSizePreference,
} from "@/lib/text-size";

/**
 * Thin React wrapper around src/lib/text-size.ts for the accessibility
 * toggle UI. The actual persistence/DOM-attribute logic lives in that
 * plain module (also used by __root.tsx's early flash-prevention script),
 * not duplicated here.
 */
export function useTextSizePreference() {
  const [preference, setPreferenceState] = useState<TextSizePreference>(() =>
    getStoredTextSizePreference(),
  );

  const setPreference = useCallback((next: TextSizePreference) => {
    setTextSizePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, setPreference };
}
