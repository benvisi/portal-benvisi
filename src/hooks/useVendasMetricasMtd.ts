import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { parseVendasMetricasLinha, type VendasMetricasLinha } from "@/lib/vendasRelatorio";

export async function fetchVendasMetricasMtd(sessionToken: string): Promise<VendasMetricasLinha[]> {
  const { data, error } = await supabase.rpc("get_vendas_metricas_mtd", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const parsed = rows.map(parseVendasMetricasLinha);
  // Fail loudly on a malformed row rather than render wrong numbers.
  if (parsed.some((row) => row === null)) {
    throw new Error("Resposta inválida de get_vendas_metricas_mtd");
  }
  return parsed as VendasMetricasLinha[];
}

/**
 * Relatório de vendas — current-month (MTD) team metrics. funcionarioId is
 * only a stable cache key; the RPC is authorized by sessionToken alone and
 * uses the RPC's default filial.
 */
export function useVendasMetricasMtd(funcionarioId: string | null, sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: ["vendas-metricas-mtd", funcionarioId],
    queryFn: () => fetchVendasMetricasMtd(sessionToken as string),
    enabled: funcionarioId !== null && sessionToken !== null,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
