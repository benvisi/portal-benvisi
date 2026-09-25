import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isLimpezaGerencialItem,
  type LimpezaGerencialItem,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function limpezaGerencialMesQueryKey(mes: string) {
  return ["limpeza-gerencial-mes", mes] as const;
}

async function fetchLimpezaGerencialMes(
  sessionToken: string,
  mes: string,
): Promise<LimpezaGerencialItem[]> {
  const { data, error } = await supabase.rpc("get_limpeza_gerencial_mes", {
    p_session_token: sessionToken,
    p_mes: mes,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.filter(isLimpezaGerencialItem) : [];
}

/**
 * Gerente/Administrador-only exceptions list (conflicts, manual overrides,
 * sem_candidato, missed). Server independently re-checks cargo — this hook
 * is only ever mounted from the Gerenciar tab, which is itself cargo-gated.
 */
export function useLimpezaGerencialMes(sessionToken: string | null, mes: string, enabled: boolean) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: limpezaGerencialMesQueryKey(mes),
    queryFn: () => fetchLimpezaGerencialMes(sessionToken as string, mes),
    enabled: enabled && sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
