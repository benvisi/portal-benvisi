import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  CONTAGEM_JA_REVISADA_MESSAGE,
  CONTAGEM_MARCAR_REVISADA_ERRO_MESSAGE,
} from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { contagemDetalheQueryKey } from "@/hooks/useContagemDetalhe";
import { CONTAGEM_HISTORICO_QUERY_KEY } from "@/hooks/useContagemHistorico";
import { CONTAGENS_PENDENTES_QUERY_KEY } from "@/hooks/useContagensPendentes";

/**
 * Administrador-only: transitions a submission pendente_revisao -> revisada.
 * Role and the valid transition are enforced server-side; an already-
 * reviewed submission returns a specific message. On success the pending,
 * history and detail queries are invalidated so the submission moves from
 * Pendentes to Histórico without a manual refresh.
 */
export function useMarcarContagemRevisada(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [marking, setMarking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const marcarRevisada = useCallback(
    async (id: string): Promise<boolean> => {
      if (marking || !sessionToken) return false;
      setMarking(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc("marcar_contagem_revisada", {
          p_session_token: sessionToken,
          p_id: id,
        });

        if (error) throw error;
        if (data !== true) {
          throw new Error("marcar_contagem_revisada did not report success");
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: CONTAGENS_PENDENTES_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: CONTAGEM_HISTORICO_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: contagemDetalheQueryKey(id) }),
        ]);
        return true;
      } catch (error) {
        console.error("[useMarcarContagemRevisada] marcar_contagem_revisada failed:", error);
        if (handleSessionError(error)) return false;
        const message = (error as { message?: unknown }).message;
        setErrorMessage(
          message === "CONTAGEM_JA_REVISADA"
            ? CONTAGEM_JA_REVISADA_MESSAGE
            : CONTAGEM_MARCAR_REVISADA_ERRO_MESSAGE,
        );
        return false;
      } finally {
        setMarking(false);
      }
    },
    [marking, sessionToken, queryClient, handleSessionError],
  );

  return { marking, errorMessage, marcarRevisada };
}
