import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isAtendimentoChecklistItem,
  type AtendimentoChecklistItem,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

const ATENDIMENTO_CHECKLIST_QUERY_KEY = ["atendimento-checklist-itens"] as const;

async function fetchAtendimentoChecklistItens(
  sessionToken: string,
): Promise<AtendimentoChecklistItem[]> {
  const { data, error } = await supabase.rpc("list_atendimento_checklist_itens", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isAtendimentoChecklistItem);
}

/**
 * The active Checklist V1 item catalog — identical for every employee, so
 * (like useAtendimentoMotivos) cached under one flat key rather than
 * partitioned by funcionarioId. Long staleTime since checklist items are
 * only ever changed by a migration in this milestone (no checklist-editor
 * UI yet).
 */
export function useAtendimentoChecklist(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: ATENDIMENTO_CHECKLIST_QUERY_KEY,
    queryFn: () => fetchAtendimentoChecklistItens(sessionToken as string),
    enabled: sessionToken !== null,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
