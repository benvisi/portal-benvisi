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
 * The caller's own count of durable pending checklist obligations
 * (Milestone 2C.1, section 16) — awareness only, no detail list, no
 * resolution action. Not polled: unlike queue/active-Atendimento state,
 * this only ever changes as a direct result of the employee's own
 * concluir_atendimento calls in this milestone, so invalidating it
 * alongside those (see useAtendimentoActions) is sufficient — a normal
 * component mount/remount also refetches it via TanStack Query defaults.
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
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}

export { checklistPendenciasCountQueryKey };
