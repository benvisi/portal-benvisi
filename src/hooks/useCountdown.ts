import { useEffect, useState } from "react";

/**
 * Displays the 20-second provisional grace period countdown. The server
 * timestamp (deadlineIso) is always authoritative (ADR-008) — this hook only
 * derives a display value from it and never decides on its own whether the
 * grace period has expired for the purpose of any backend action.
 *
 * Reads Date.now() fresh at render time rather than a cached "now" in
 * state (same fix applied to useElapsedMinutes, for the same class of bug:
 * a cached value can go stale relative to a deadline that changes between
 * ticks). deadlineIso doesn't currently shift after being set, so this was
 * not observed to misbehave here, but the pattern is kept consistent.
 */
export function useCountdown(deadlineIso: string | null) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!deadlineIso) return;
    const interval = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(interval);
  }, [deadlineIso]);

  if (!deadlineIso) {
    return { secondsLeft: 0, isExpired: true };
  }

  const msLeft = new Date(deadlineIso).getTime() - Date.now();
  return {
    secondsLeft: Math.max(0, Math.ceil(msLeft / 1000)),
    isExpired: msLeft <= 0,
  };
}
