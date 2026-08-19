import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isAtendimentoMotivo, type AtendimentoMotivo } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

const ATENDIMENTO_MOTIVOS_QUERY_KEY = ["atendimento-motivos"] as const;

async function fetchAtendimentoMotivos(sessionToken: string): Promise<AtendimentoMotivo[]> {
  const { data, error } = await supabase.rpc("list_atendimento_motivos", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isAtendimentoMotivo);
}

/**
 * The active motive catalog — identical for every employee, so unlike the
 * other Atendimento hooks this is cached under one flat key rather than
 * partitioned by funcionarioId. Long staleTime since motives are only ever
 * changed by a migration in this milestone (no motive-editor UI yet).
 */
export function useAtendimentoMotivos(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: ATENDIMENTO_MOTIVOS_QUERY_KEY,
    queryFn: () => fetchAtendimentoMotivos(sessionToken as string),
    enabled: sessionToken !== null,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
