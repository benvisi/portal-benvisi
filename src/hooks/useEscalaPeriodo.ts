import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isEscalaEntradaPeriodo,
  type EscalaEntradaPeriodo,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function escalaPeriodoQueryKey(dataInicio: string, dataFim: string) {
  return ["escala-periodo", dataInicio, dataFim] as const;
}

async function fetchEscalaPeriodo(
  sessionToken: string,
  dataInicio: string,
  dataFim: string,
): Promise<EscalaEntradaPeriodo[]> {
  const { data, error } = await supabase.rpc("get_escala_periodo", {
    p_session_token: sessionToken,
    p_data_inicio: dataInicio,
    p_data_fim: dataFim,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isEscalaEntradaPeriodo);
}

/**
 * Team schedule for a date range — powers both Hoje (single-day range) and
 * Semana (7-day range). Gestão visibility is enforced entirely server-side
 * (get_escala_periodo, Milestone 4C.1): this hook simply renders whatever
 * rows come back, with no client-side filtering of its own.
 */
export function useEscalaPeriodo(sessionToken: string | null, dataInicio: string, dataFim: string) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: escalaPeriodoQueryKey(dataInicio, dataFim),
    queryFn: () => fetchEscalaPeriodo(sessionToken as string, dataInicio, dataFim),
    enabled: sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
