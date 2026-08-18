import { useEffect, useState } from "react";

const TICK_INTERVAL_MS = 30_000;

/**
 * Elapsed minutes since the server's iniciado_em, ticking locally on an
 * interval instead of re-querying the backend — iniciado_em only needs to
 * be refreshed by the normal Lista da Vez poll (useListaVez), not on every
 * tick of this display.
 */
export function useElapsedMinutes(iniciadoEm: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!iniciadoEm) return;
    const interval = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [iniciadoEm]);

  if (!iniciadoEm) return null;

  const ms = now - new Date(iniciadoEm).getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}
