import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ATENDIMENTO_GENERIC_ERROR_MESSAGE } from "@/config/constants";
import { checklistPendenciasCountQueryKey } from "@/hooks/useChecklistPendenciasCount";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getAtendimentoErrorMessage, isSemChecklistPendenteError } from "@/lib/atendimento-error";
import type { ChecklistRespostaInput } from "@/hooks/useAtendimentoActions";

export type ConcluirChecklistAvulsoResult =
  { status: "ok"; resolvedCount: number } | { status: "no_pending" } | { status: "error" };

/**
 * Milestone 2C.2: standalone checklist completion, independent of any
 * Atendimento. Never touches atendimentoAtivo/listaVez query state — a
 * standalone completion never creates an Atendimento or mutates queue
 * membership (section 42) — only the employee's own pending-count cache is
 * invalidated on success (or on the "someone else already resolved it"
 * race, so the caller can quietly refresh to zero rather than show a
 * persistent error for a race the employee lost nothing by losing).
 */
export function useConcluirChecklistAvulso(
  funcionarioId: string | null,
  sessionToken: string | null,
) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const invalidatePendingCount = useCallback(() => {
    if (!funcionarioId) return;
    void queryClient.invalidateQueries({
      queryKey: checklistPendenciasCountQueryKey(funcionarioId),
    });
  }, [queryClient, funcionarioId]);

  const concluir = useCallback(
    async (checklist: ChecklistRespostaInput[]): Promise<ConcluirChecklistAvulsoResult> => {
      if (submitting || !sessionToken) return { status: "error" };
      setSubmitting(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc("concluir_checklist_avulso", {
          p_session_token: sessionToken,
          p_checklist: checklist,
        });
        if (error) throw error;
        if (typeof data !== "number") {
          throw new Error("concluir_checklist_avulso returned no number");
        }
        invalidatePendingCount();
        return { status: "ok", resolvedCount: data };
      } catch (error) {
        console.error("[useConcluirChecklistAvulso] concluir_checklist_avulso failed:", error);
        if (handleSessionError(error)) return { status: "error" };
        if (isSemChecklistPendenteError(error)) {
          invalidatePendingCount();
          return { status: "no_pending" };
        }
        setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
        return { status: "error" };
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, invalidatePendingCount, handleSessionError],
  );

  return { submitting, errorMessage, concluir };
}
