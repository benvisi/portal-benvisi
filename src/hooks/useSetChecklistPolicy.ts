import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ATENDIMENTO_GENERIC_ERROR_MESSAGE } from "@/config/constants";
import type { ChecklistPolicy } from "@/integrations/supabase/contracts";
import { CHECKLIST_POLICY_QUERY_KEY } from "@/hooks/useChecklistPolicy";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getAtendimentoErrorMessage } from "@/lib/atendimento-error";

/**
 * Admin-only checklist-policy mutation (Milestone 2C.1, section 3/5).
 * set_checklist_policy independently re-checks cargo = 'Administrador'
 * server-side — this hook has no special access itself, it just calls the
 * RPC and surfaces its result, matching every other action hook in this
 * project (no client-side authorization decision is trusted).
 */
export function useSetChecklistPolicy(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setPolicy = useCallback(
    async (policy: ChecklistPolicy): Promise<boolean> => {
      if (submitting || !sessionToken) return false;
      setSubmitting(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc("set_checklist_policy", {
          p_session_token: sessionToken,
          p_policy: policy,
        });
        if (error) throw error;
        if (data !== true) throw new Error("set_checklist_policy did not report success");
        void queryClient.invalidateQueries({ queryKey: CHECKLIST_POLICY_QUERY_KEY });
        return true;
      } catch (error) {
        console.error("[useSetChecklistPolicy] set_checklist_policy failed:", error);
        if (handleSessionError(error)) return false;
        setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, queryClient, handleSessionError],
  );

  return { submitting, errorMessage, setPolicy };
}
