import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isEscalaEntradaMes, type EscalaEntradaMes } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function minhaEscalaMesQueryKey(mes: string) {
  return ["minha-escala-mes", mes] as const;
}

async function fetchMinhaEscalaMes(sessionToken: string, mes: string): Promise<EscalaEntradaMes[]> {
  const { data, error } = await supabase.rpc("get_minha_escala_mes", {
    p_session_token: sessionToken,
    p_mes: mes,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isEscalaEntradaMes);
}

/**
 * The caller's own schedule for one calendar month — powers Mês/Minha
 * Escala. No Gestão check is needed client-side or server-side beyond
 * identity: every employee may always see their own schedule.
 */
export function useMinhaEscalaMes(sessionToken: string | null, mes: string) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: minhaEscalaMesQueryKey(mes),
    queryFn: () => fetchMinhaEscalaMes(sessionToken as string, mes),
    enabled: sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
