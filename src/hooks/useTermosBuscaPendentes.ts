import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isTermoBuscaPendente, type TermoBuscaPendente } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const TERMOS_BUSCA_PENDENTES_QUERY_KEY = ["termos-busca-pendentes"] as const;

/**
 * Management-only moderation queue (oldest first). The RPC enforces the
 * pode_gerenciar_termos_busca capability; `active` keeps the tab from
 * fetching while hidden.
 */
export function useTermosBuscaPendentes(sessionToken: string | null, active: boolean) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: TERMOS_BUSCA_PENDENTES_QUERY_KEY,
    queryFn: async (): Promise<TermoBuscaPendente[]> => {
      const { data, error } = await supabase.rpc("get_termos_busca_pendentes", {
        p_session_token: sessionToken as string,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows.filter(isTermoBuscaPendente);
    },
    enabled: sessionToken !== null && active,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
