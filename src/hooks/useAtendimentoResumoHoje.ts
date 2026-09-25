import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isAtendimentoResumoHojeLinha,
  type AtendimentoResumoHojeLinha,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function atendimentoResumoHojeQueryKey(funcionarioId: string) {
  return ["atendimento-resumo-hoje", funcionarioId] as const;
}

async function fetchAtendimentoResumoHoje(
  sessionToken: string,
): Promise<AtendimentoResumoHojeLinha[]> {
  const { data, error } = await supabase.rpc("get_atendimento_resumo_hoje", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isAtendimentoResumoHojeLinha);
}

/**
 * Card #36 — store-wide, role-agnostic "resumo dos atendimentos de hoje".
 * funcionarioId is only a stable cache key (safe, non-privileged); the RPC
 * itself is authorized by sessionToken alone and returns the same data to
 * every caller regardless of who they are.
 *
 * Polls every 60s (a "today so far" summary does not need Lista da Vez's 5s
 * cadence). useAtendimentoActions additionally invalidates this query right
 * after a successful finalization mutation, so the local user's own
 * just-completed Atendimento appears without waiting for the next poll.
 */
export function useAtendimentoResumoHoje(
  funcionarioId: string | null,
  sessionToken: string | null,
) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: funcionarioId
      ? atendimentoResumoHojeQueryKey(funcionarioId)
      : ["atendimento-resumo-hoje", null],
    queryFn: () => fetchAtendimentoResumoHoje(sessionToken as string),
    enabled: funcionarioId !== null && sessionToken !== null,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}

export { atendimentoResumoHojeQueryKey };
