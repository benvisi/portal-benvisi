import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isLimpezaAtribuicaoDia,
  type LimpezaAtribuicaoDia,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function limpezaDiaQueryKey(data: string) {
  return ["limpeza-dia", data] as const;
}

async function fetchLimpezaDia(
  sessionToken: string,
  data: string,
): Promise<LimpezaAtribuicaoDia[]> {
  const { data: rows, error } = await supabase.rpc("get_limpeza_dia", {
    p_session_token: sessionToken,
    p_data: data,
  });

  if (error) throw error;

  return Array.isArray(rows) ? rows.filter(isLimpezaAtribuicaoDia) : [];
}

/**
 * One day's four cleaning slots (manhã/tarde x varrer/passar pano). The RPC
 * reconciles today-or-future dates against the current Escala before
 * returning — past dates and completed rows are always returned as-is.
 */
export function useLimpezaDia(sessionToken: string | null, data: string) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: limpezaDiaQueryKey(data),
    queryFn: () => fetchLimpezaDia(sessionToken as string, data),
    enabled: sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
