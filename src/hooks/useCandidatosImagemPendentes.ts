import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isCandidatoImagemPendente,
  type CandidatoImagemPendente,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY = ["candidatos-imagem-pendentes"] as const;

export async function fetchCandidatosImagemPendentes(
  sessionToken: string,
): Promise<CandidatoImagemPendente[]> {
  const { data, error } = await supabase.rpc("get_candidatos_imagem_pendentes", {
    p_session_token: sessionToken,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  // A malformed row is a contract break, not something to silently skip.
  if (!rows.every(isCandidatoImagemPendente)) {
    throw new Error("get_candidatos_imagem_pendentes returned an unexpected row shape");
  }
  return rows;
}

/**
 * Reviewer queue (oldest first). The RPC enforces the
 * pode_gerenciar_imagens_produto capability; callers pass a null token until
 * the permission is confirmed so nothing is fetched for unauthorized users.
 */
export function useCandidatosImagemPendentes(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY,
    queryFn: () => fetchCandidatosImagemPendentes(sessionToken as string),
    enabled: sessionToken !== null,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
