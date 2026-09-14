import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isEscalaPublicacaoHistorico,
  type EscalaPublicacaoHistorico,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const ESCALA_PUBLICACOES_HISTORICO_QUERY_KEY = ["escala-publicacoes-historico"] as const;

async function fetchHistorico(sessionToken: string): Promise<EscalaPublicacaoHistorico[]> {
  const { data, error } = await supabase.rpc("get_escala_publicacoes_historico", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isEscalaPublicacaoHistorico);
}

/**
 * Administrador-only publication history. The RPC enforces the role
 * server-side; `enabled` additionally gates the fetch to when the Histórico
 * tab is actually visible.
 */
export function useEscalaPublicacoesHistorico(sessionToken: string | null, enabled = true) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: ESCALA_PUBLICACOES_HISTORICO_QUERY_KEY,
    queryFn: () => fetchHistorico(sessionToken as string),
    enabled: sessionToken !== null && enabled,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
