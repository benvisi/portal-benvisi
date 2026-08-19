import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isAtendimentoAtivo, type AtendimentoAtivo } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function atendimentoAtivoQueryKey(funcionarioId: string) {
  return ["atendimento-ativo", funcionarioId] as const;
}

async function fetchAtendimentoAtivo(sessionToken: string): Promise<AtendimentoAtivo | null> {
  const { data, error } = await supabase.rpc("get_atendimento_ativo", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const row = rows[0];
  return row !== undefined && isAtendimentoAtivo(row) ? row : null;
}

/**
 * Drives resume-after-navigation/refresh (ADR-009): the active Atendimento
 * lives entirely on the server, so re-mounting /atendimento just re-fetches
 * this instead of relying on any client-side state.
 *
 * Polls every 5s (matching useListaVez) so that a responsible employee
 * already sitting on their own /atendimento page picks up a delegated start
 * — performed by someone else, so nothing on this page triggers a local
 * invalidation — within a few seconds, without a manual refresh (Milestone
 * 2A.1 section 11) and without adding realtime subscription infrastructure.
 */
export function useAtendimentoAtivo(funcionarioId: string | null, sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: funcionarioId ? atendimentoAtivoQueryKey(funcionarioId) : ["atendimento-ativo", null],
    queryFn: () => fetchAtendimentoAtivo(sessionToken as string),
    enabled: funcionarioId !== null && sessionToken !== null,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}

export { atendimentoAtivoQueryKey };
