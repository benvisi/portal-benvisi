import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isContagemHistoricoRegistro,
  type ContagemHistoricoRegistro,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const CONTAGEM_HISTORICO_QUERY_KEY = ["contagem-historico"] as const;

async function fetchContagemHistorico(sessionToken: string): Promise<ContagemHistoricoRegistro[]> {
  const { data, error } = await supabase.rpc("get_contagem_historico", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isContagemHistoricoRegistro);
}

/**
 * Administrador-only: submissions already marked reviewed, most recently
 * reviewed first. Role is enforced server-side by the RPC.
 */
export function useContagemHistorico(sessionToken: string | null, enabled = true) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: CONTAGEM_HISTORICO_QUERY_KEY,
    queryFn: () => fetchContagemHistorico(sessionToken as string),
    enabled: sessionToken !== null && enabled,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
