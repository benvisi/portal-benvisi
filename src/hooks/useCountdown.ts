import { useEffect, useState } from "react";

/**
 * Displays the 20-second provisional grace period countdown. The server
 * timestamp (deadlineIso) is always authoritative (ADR-008) — this hook only
 * derives a display value from it and never decides on its own whether the
 * grace period has expired for the purpose of any backend action.
 */
export function useCountdown(deadlineIso: string | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineIso) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [deadlineIso]);

  if (!deadlineIso) {
    return { secondsLeft: 0, isExpired: true };
  }

  const msLeft = new Date(deadlineIso).getTime() - now;
  return {
    secondsLeft: Math.max(0, Math.ceil(msLeft / 1000)),
    isExpired: msLeft <= 0,
  };
}
