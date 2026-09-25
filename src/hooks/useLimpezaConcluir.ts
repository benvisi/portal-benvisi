import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isLimpezaConclusao } from "@/integrations/supabase/contracts";
import { limpezaDiaQueryKey } from "@/hooks/useLimpezaDia";
import { limpezaMesQueryKey } from "@/hooks/useLimpezaMes";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getLimpezaConcluirErrorMessage } from "@/lib/limpeza";

/**
 * Marks a limpeza assignment Concluído. Idempotent server-side: a repeated
 * tap on an already-completed assignment (double-click, slow network retry)
 * returns the original completion rather than erroring or duplicating.
 */
export function useLimpezaConcluir(sessionToken: string | null, data: string, mes: string) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const concluir = useCallback(
    async (atribuicaoId: string): Promise<boolean> => {
      if (!sessionToken || pendingId !== null) return false;
      setPendingId(atribuicaoId);
      setErrorMessage(null);

      try {
        const { data: result, error } = await supabase.rpc("limpeza_concluir_atribuicao", {
          p_session_token: sessionToken,
          p_atribuicao_id: atribuicaoId,
        });
        if (error) throw error;

        const row = Array.isArray(result) ? result[0] : result;
        if (!isLimpezaConclusao(row)) throw new Error("RESPOSTA_INVALIDA");

        await queryClient.invalidateQueries({ queryKey: limpezaDiaQueryKey(data) });
        await queryClient.invalidateQueries({ queryKey: limpezaMesQueryKey(mes) });
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getLimpezaConcluirErrorMessage(error));
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [sessionToken, pendingId, queryClient, data, mes, handleSessionError],
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return { pendingId, errorMessage, clearError, concluir };
}
