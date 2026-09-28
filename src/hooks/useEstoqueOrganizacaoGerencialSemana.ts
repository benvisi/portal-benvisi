import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isEstoqueOrganizacaoAtribuicaoSemana,
  type EstoqueOrganizacaoAtribuicaoSemana,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function estoqueOrganizacaoGerencialSemanaQueryKey(semanaInicio: string) {
  return ["estoque-organizacao-gerencial-semana", semanaInicio] as const;
}

async function fetchEstoqueOrganizacaoGerencialSemana(
  sessionToken: string,
  semanaInicio: string,
): Promise<EstoqueOrganizacaoAtribuicaoSemana[]> {
  const { data, error } = await supabase.rpc("get_estoque_organizacao_gerencial_semana", {
    p_session_token: sessionToken,
    p_semana_inicio: semanaInicio,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.filter(isEstoqueOrganizacaoAtribuicaoSemana) : [];
}

/**
 * Gerente/Administrador-only: any week (current or previous), for the
 * Gerenciar tab's week selector. Server independently re-checks cargo — this
 * hook is only ever mounted from the Gerenciar tab, which is itself
 * cargo-gated.
 */
export function useEstoqueOrganizacaoGerencialSemana(
  sessionToken: string | null,
  semanaInicio: string,
  enabled: boolean,
) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: estoqueOrganizacaoGerencialSemanaQueryKey(semanaInicio),
    queryFn: () => fetchEstoqueOrganizacaoGerencialSemana(sessionToken as string, semanaInicio),
    enabled: enabled && sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
