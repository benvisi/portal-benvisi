import { useEffect, useState } from "react";

const TICK_INTERVAL_MS = 30_000;

/**
 * Elapsed minutes since the server's iniciado_em, ticking locally on an
 * interval instead of re-querying the backend — iniciado_em only needs to
 * be refreshed by the normal Lista da Vez poll (useListaVez), not on every
 * tick of this display.
 *
 * The ms calculation always reads Date.now() fresh at render time rather
 * than a cached "now" value in state. A cached value previously caused a
 * confirmed bug: `tick` state only advances on the 30s interval, so if
 * iniciadoEm jumps forward between ticks (e.g. after Voltar ao atendimento
 * shifts the effective start), a stale cached "now" compared against the
 * new, later iniciadoEm produced a negative difference — clamped to 0 and
 * displayed as "< 1 min" — for up to 30 seconds until the next tick
 * happened to refresh it. `tick` now exists only to force a re-render
 * every 30s while idle; it is never read for the actual calculation.
 */
export function useElapsedMinutes(iniciadoEm: string | null): number | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!iniciadoEm) return;
    const interval = setInterval(() => setTick((n) => n + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [iniciadoEm]);

  if (!iniciadoEm) return null;

  const ms = Date.now() - new Date(iniciadoEm).getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}
