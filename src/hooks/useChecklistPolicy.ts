import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isChecklistPolicy, type ChecklistPolicy } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

const CHECKLIST_POLICY_QUERY_KEY = ["checklist-policy"] as const;

async function fetchChecklistPolicy(sessionToken: string): Promise<ChecklistPolicy> {
  const { data, error } = await supabase.rpc("get_checklist_policy", {
    p_session_token: sessionToken,
  });

  if (error) throw error;
  if (!isChecklistPolicy(data)) throw new Error("get_checklist_policy returned an invalid policy");

  return data;
}

/**
 * The store-wide checklist policy — identical for every employee, so
 * (like useAtendimentoMotivos/useAtendimentoChecklist) cached under one flat
 * key. Polled every 5s while mounted (Milestone 2C.1 section 6) so an
 * open closing form or the admin policy screen notices a policy change made
 * from elsewhere within a few seconds — the backend independently
 * re-validates the authoritative policy at final submission regardless of
 * how stale this client-side value happens to be.
 */
export function useChecklistPolicy(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: CHECKLIST_POLICY_QUERY_KEY,
    queryFn: () => fetchChecklistPolicy(sessionToken as string),
    enabled: sessionToken !== null,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}

export { CHECKLIST_POLICY_QUERY_KEY };
