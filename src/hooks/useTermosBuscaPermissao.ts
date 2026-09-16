import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const TERMOS_BUSCA_PERMISSAO_QUERY_KEY = ["termos-busca-permissao"] as const;

/**
 * Whether the current employee holds funcionarios.pode_gerenciar_termos_busca.
 * UI gating only (show/hide the management entry points and route): every
 * management RPC re-checks the capability server-side regardless.
 */
export function useTermosBuscaPermissao(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: TERMOS_BUSCA_PERMISSAO_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_termos_busca_permissao", {
        p_session_token: sessionToken as string,
      });
      if (error) throw error;
      return data === true;
    },
    enabled: sessionToken !== null,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return { ...query, podeGerenciar: query.data === true };
}
