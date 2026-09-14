import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { CONTAGEM_CANCELAR_ERRO_MESSAGE } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { CONTAGEM_ATIVA_QUERY_KEY } from "@/hooks/useContagemAtiva";

/**
 * Milestone 4D.1 — abandons the caller's open em_andamento draft outright
 * (cancelar_contagem_ativa deletes the header row; contagem_itens cascades).
 * Any authenticated employee, matching finalize/resume's "any authorized
 * employee" access model. Never reaches a pendente_revisao/revisada row —
 * the RPC's own status check guarantees that server-side.
 */
export function useCancelarContagem(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [cancelling, setCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cancelar = useCallback(
    async (idContagem: string): Promise<boolean> => {
      if (cancelling || !sessionToken) return false;
      setCancelling(true);
      setErrorMessage(null);

      try {
        const { error } = await supabase.rpc("cancelar_contagem_ativa", {
          p_session_token: sessionToken,
          p_id_contagem: idContagem,
        });

        if (error) throw error;

        void queryClient.invalidateQueries({ queryKey: CONTAGEM_ATIVA_QUERY_KEY });
        return true;
      } catch (error) {
        console.error("[useCancelarContagem] cancelar_contagem_ativa failed:", error);
        if (handleSessionError(error)) return false;
        setErrorMessage(CONTAGEM_CANCELAR_ERRO_MESSAGE);
        return false;
      } finally {
        setCancelling(false);
      }
    },
    [cancelling, sessionToken, queryClient, handleSessionError],
  );

  return {
    cancelling,
    errorMessage,
    cancelar,
    clearError: useCallback(() => setErrorMessage(null), []),
  };
}
