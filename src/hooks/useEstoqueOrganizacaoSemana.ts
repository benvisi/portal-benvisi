import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isEstoqueOrganizacaoAtribuicaoSemana,
  type EstoqueOrganizacaoAtribuicaoSemana,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const estoqueOrganizacaoSemanaQueryKey = ["estoque-organizacao-semana"] as const;

async function fetchEstoqueOrganizacaoSemana(
  sessionToken: string,
): Promise<EstoqueOrganizacaoAtribuicaoSemana[]> {
  const { data, error } = await supabase.rpc("get_estoque_organizacao_semana", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.filter(isEstoqueOrganizacaoAtribuicaoSemana) : [];
}

/**
 * The current week's team table — always the current week (the RPC takes no
 * date parameter; see its migration header for why). Everyone sees this,
 * same team-transparency convention as Limpeza/Escala.
 */
export function useEstoqueOrganizacaoSemana(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: estoqueOrganizacaoSemanaQueryKey,
    queryFn: () => fetchEstoqueOrganizacaoSemana(sessionToken as string),
    enabled: sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
