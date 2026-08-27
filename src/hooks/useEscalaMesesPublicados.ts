import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isEscalaMesPublicado, type EscalaMesPublicado } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

const ESCALA_MESES_PUBLICADOS_QUERY_KEY = ["escala-meses-publicados"] as const;

async function fetchEscalaMesesPublicados(sessionToken: string): Promise<EscalaMesPublicado[]> {
  const { data, error } = await supabase.rpc("list_escala_meses_publicados", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isEscalaMesPublicado);
}

/**
 * Which months currently have an active publication. Used to gate the Mês
 * view's forward navigation — "previous/current month always; a future
 * month only if it has been explicitly published" — without duplicating
 * that rule per navigation control.
 */
export function useEscalaMesesPublicados(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: ESCALA_MESES_PUBLICADOS_QUERY_KEY,
    queryFn: () => fetchEscalaMesesPublicados(sessionToken as string),
    enabled: sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
