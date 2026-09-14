import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { CONTAGEM_ENVIO_ERRO_MESSAGE } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { CONTAGENS_PENDENTES_QUERY_KEY } from "@/hooks/useContagensPendentes";
import { CONTAGEM_ATIVA_QUERY_KEY } from "@/hooks/useContagemAtiva";

export interface ContagemItemPayload {
  id_item: string;
  pacotes_fechados: number;
  unidades_avulsas: number;
}

/**
 * Milestone 4D.1 — finalizes the caller's already-open em_andamento draft
 * (started via useContagemAtiva), locking it into pendente_revisao. The
 * submitter and timestamp are resolved server-side from the session token
 * at this moment — this hook never sends an employee id. The client is
 * expected to have validated completeness first; the RPC independently
 * rejects an incomplete/tampered payload, and any such failure surfaces as
 * the generic error message (it is not a normal path). Also rejects if the
 * draft was already finalized by someone else in the meantime
 * (CONTAGEM_JA_FINALIZADA) — the caller should refetch the active draft on
 * failure, since a fresh one may now exist. Returns the finalized contagem
 * id on success, or null on failure.
 */
export function useFinalizarContagem(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const finalizar = useCallback(
    async (
      idContagem: string,
      itens: readonly ContagemItemPayload[],
      observacao: string | null,
    ): Promise<string | null> => {
      if (submitting || !sessionToken) return null;
      setSubmitting(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc("finalizar_contagem", {
          p_session_token: sessionToken,
          p_id_contagem: idContagem,
          p_itens: itens,
          p_observacao: observacao,
        });

        if (error) throw error;
        if (typeof data !== "string" || data.length === 0) {
          throw new Error("finalizar_contagem returned no id");
        }

        void queryClient.invalidateQueries({ queryKey: CONTAGENS_PENDENTES_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: CONTAGEM_ATIVA_QUERY_KEY });
        return data;
      } catch (error) {
        console.error("[useFinalizarContagem] finalizar_contagem failed:", error);
        void queryClient.invalidateQueries({ queryKey: CONTAGEM_ATIVA_QUERY_KEY });
        if (handleSessionError(error)) return null;
        setErrorMessage(CONTAGEM_ENVIO_ERRO_MESSAGE);
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, queryClient, handleSessionError],
  );

  return {
    submitting,
    errorMessage,
    finalizar,
    clearError: useCallback(() => setErrorMessage(null), []),
  };
}
