import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function checklistPendenciasCountQueryKey(funcionarioId: string) {
  return ["checklist-pendencias-count", funcionarioId] as const;
}

async function fetchChecklistPendenciasCount(sessionToken: string): Promise<number> {
  const { data, error } = await supabase.rpc("get_checklist_pendencias_count", {
    p_session_token: sessionToken,
  });

  if (error) throw error;
  if (typeof data !== "number") {
    throw new Error("get_checklist_pendencias_count returned no number");
  }

  return data;
}

/**
 * The caller's own count of durable pending checklist obligations —
 * awareness only, no detail list. Invalidated locally after the employee's
 * own concluir_atendimento/concluir_checklist_avulso calls (see
 * useAtendimentoActions/useConcluirChecklistAvulso), and also polled
 * (Milestone 2C.2 section 39) since a pending obligation can now be created
 * or resolved from another device — same 5s interval already used by
 * useListaVez/useAtendimentoAtivo/useChecklistPolicy for the same reason,
 * and this hook now backs a persistent indicator shown across multiple
 * authenticated pages, not just /atendimento.
 */
export function useChecklistPendenciasCount(
  funcionarioId: string | null,
  sessionToken: string | null,
) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: funcionarioId
      ? checklistPendenciasCountQueryKey(funcionarioId)
      : ["checklist-pendencias-count", null],
    queryFn: () => fetchChecklistPendenciasCount(sessionToken as string),
    enabled: funcionarioId !== null && sessionToken !== null,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}

export { checklistPendenciasCountQueryKey };
