import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isContagemPendente, type ContagemPendente } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const CONTAGENS_PENDENTES_QUERY_KEY = ["contagens-pendentes"] as const;

async function fetchContagensPendentes(sessionToken: string): Promise<ContagemPendente[]> {
  const { data, error } = await supabase.rpc("get_contagens_pendentes", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isContagemPendente);
}

/**
 * Administrador-only review queue: submissions still pending review, oldest
 * first. The RPC enforces the role server-side; a non-admin never reaches
 * this hook (the route only mounts it for an Administrador).
 */
export function useContagensPendentes(sessionToken: string | null, enabled = true) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: CONTAGENS_PENDENTES_QUERY_KEY,
    queryFn: () => fetchContagensPendentes(sessionToken as string),
    enabled: sessionToken !== null && enabled,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
