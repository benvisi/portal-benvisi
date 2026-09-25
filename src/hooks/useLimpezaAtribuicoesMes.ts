import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isLimpezaAtribuicaoMes,
  type LimpezaAtribuicaoMes,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function limpezaAtribuicoesMesQueryKey(mes: string) {
  return ["limpeza-atribuicoes-mes", mes] as const;
}

async function fetchLimpezaAtribuicoesMes(
  sessionToken: string,
  mes: string,
): Promise<LimpezaAtribuicaoMes[]> {
  const { data, error } = await supabase.rpc("get_limpeza_atribuicoes_mes", {
    p_session_token: sessionToken,
    p_mes: mes,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.filter(isLimpezaAtribuicaoMes) : [];
}

/**
 * Gerente/Administrador-only: every cleaning assignment for the month — the
 * "Atribuições do mês" management list (distinct from
 * get_limpeza_gerencial_mes's exceptions-only list). Lets a manager Alterar
 * any assignment, not only the ones already flagged as an exception.
 */
export function useLimpezaAtribuicoesMes(
  sessionToken: string | null,
  mes: string,
  enabled: boolean,
) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: limpezaAtribuicoesMesQueryKey(mes),
    queryFn: () => fetchLimpezaAtribuicoesMes(sessionToken as string, mes),
    enabled: enabled && sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
