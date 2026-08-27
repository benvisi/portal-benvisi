import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { CONTAGEM_ENVIO_ERRO_MESSAGE } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { CONTAGENS_PENDENTES_QUERY_KEY } from "@/hooks/useContagensPendentes";

export interface SubmeterContagemItem {
  id_item: string;
  pacotes_fechados: number;
  unidades_avulsas: number;
}

/**
 * Submits one packaging count. The submitter and timestamp are resolved
 * server-side from the session token — this hook never sends an employee
 * id. The client is expected to have validated completeness first; the RPC
 * independently rejects an incomplete/tampered payload, and any such
 * failure surfaces as the generic error message (it is not a normal path).
 * Returns the new contagem id on success, or null on failure.
 */
export function useSubmeterContagem(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submeter = useCallback(
    async (
      itens: readonly SubmeterContagemItem[],
      observacao: string | null,
    ): Promise<string | null> => {
      if (submitting || !sessionToken) return null;
      setSubmitting(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc("submeter_contagem", {
          p_session_token: sessionToken,
          p_itens: itens,
          p_observacao: observacao,
        });

        if (error) throw error;
        if (typeof data !== "string" || data.length === 0) {
          throw new Error("submeter_contagem returned no id");
        }

        void queryClient.invalidateQueries({ queryKey: CONTAGENS_PENDENTES_QUERY_KEY });
        return data;
      } catch (error) {
        console.error("[useSubmeterContagem] submeter_contagem failed:", error);
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
    submeter,
    clearError: useCallback(() => setErrorMessage(null), []),
  };
}
