import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import {
  parseVendasMetricasLinha,
  type VendasMetricasLinha,
  type VendasPeriodo,
} from "@/lib/vendasRelatorio";

export async function fetchVendasMetricasPeriodo(
  sessionToken: string,
  periodo: VendasPeriodo,
): Promise<VendasMetricasLinha[]> {
  const { data, error } = await supabase.rpc("get_vendas_metricas_periodo", {
    p_session_token: sessionToken,
    p_periodo: periodo,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const parsed = rows.map(parseVendasMetricasLinha);
  // Fail loudly on a malformed row rather than render wrong numbers.
  if (parsed.some((row) => row === null)) {
    throw new Error("Resposta inválida de get_vendas_metricas_periodo");
  }
  return parsed as VendasMetricasLinha[];
}

/**
 * Query options for one period of Relatório de vendas. The period is part of
 * the query key, so each period has its own cache entry. funcionarioId is
 * only a stable cache key; the RPC is authorized by sessionToken alone and
 * resolves the date range server-side (the browser never sends dates).
 */
export function vendasMetricasPeriodoQueryOptions(
  funcionarioId: string | null,
  sessionToken: string | null,
  periodo: VendasPeriodo,
) {
  return {
    queryKey: ["vendas-metricas-periodo", funcionarioId, periodo] as const,
    queryFn: () => fetchVendasMetricasPeriodo(sessionToken as string, periodo),
    enabled: funcionarioId !== null && sessionToken !== null,
    refetchInterval: 60_000,
  };
}

/** Relatório de vendas — team metrics for the selected period. */
export function useVendasMetricasPeriodo(
  funcionarioId: string | null,
  sessionToken: string | null,
  periodo: VendasPeriodo,
) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery(vendasMetricasPeriodoQueryOptions(funcionarioId, sessionToken, periodo));

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
