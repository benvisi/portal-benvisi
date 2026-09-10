import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that only updates after `delayMs` has passed
 * without a further change. Used to keep the estoque search responsive while
 * a salesperson types on a phone without firing an RPC per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
