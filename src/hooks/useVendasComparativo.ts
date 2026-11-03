import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import {
  parseVendasComparativoJanela,
  type VendasComparativoJanela,
} from "@/lib/vendasComparativo";
import type { VendasPeriodo } from "@/lib/vendasRelatorio";

export async function fetchVendasComparativo(
  sessionToken: string,
  periodo: VendasPeriodo,
  incluirHoje: boolean,
): Promise<VendasComparativoJanela[]> {
  const { data, error } = await supabase.rpc("get_vendas_comparativo_periodo", {
    p_session_token: sessionToken,
    p_periodo: periodo,
    p_incluir_hoje: incluirHoje,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const parsed = rows.map(parseVendasComparativoJanela);
  // Fail loudly on a malformed row rather than render wrong numbers.
  if (parsed.some((row) => row === null)) {
    throw new Error("Resposta inválida de get_vendas_comparativo_periodo");
  }
  return parsed as VendasComparativoJanela[];
}

/**
 * Query options for the store-level comparison. Period and the Incluir hoje
 * toggle are part of the key (one cache entry each); funcionarioId is only a
 * stable cache key — the RPC is authorized by sessionToken alone and resolves
 * every date range server-side.
 */
export function vendasComparativoQueryOptions(
  funcionarioId: string | null,
  sessionToken: string | null,
  periodo: VendasPeriodo,
  incluirHoje: boolean,
) {
  return {
    queryKey: ["vendas-comparativo", funcionarioId, periodo, incluirHoje] as const,
    queryFn: () => fetchVendasComparativo(sessionToken as string, periodo, incluirHoje),
    enabled: funcionarioId !== null && sessionToken !== null,
    refetchInterval: 60_000,
  };
}

/** Relatório de vendas — Comparativo view (store totals across years). */
export function useVendasComparativo(
  funcionarioId: string | null,
  sessionToken: string | null,
  periodo: VendasPeriodo,
  incluirHoje: boolean,
) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery(
    vendasComparativoQueryOptions(funcionarioId, sessionToken, periodo, incluirHoje),
  );

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
