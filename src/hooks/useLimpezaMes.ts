import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isLimpezaResumoMensal, type LimpezaResumoMensal } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function limpezaMesQueryKey(mes: string) {
  return ["limpeza-mes", mes] as const;
}

async function fetchLimpezaMes(sessionToken: string, mes: string): Promise<LimpezaResumoMensal[]> {
  const { data, error } = await supabase.rpc("get_limpeza_mes", {
    p_session_token: sessionToken,
    p_mes: mes,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.filter(isLimpezaResumoMensal) : [];
}

/**
 * Team-visible monthly transparency summary — one row per currently-eligible
 * funcionario, alphabetical. Not a leaderboard: never sorted by performance.
 */
export function useLimpezaMes(sessionToken: string | null, mes: string) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: limpezaMesQueryKey(mes),
    queryFn: () => fetchLimpezaMes(sessionToken as string, mes),
    enabled: sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
