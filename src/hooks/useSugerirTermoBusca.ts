import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { produtoTermosBuscaQueryKey } from "@/hooks/useProdutoTermosBusca";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getTermoBuscaErrorMessage } from "@/lib/termosBusca";

/**
 * Employee suggestion of one term for one produto (sugerir_termo_busca).
 * Validation and duplicate rules are enforced server-side; the RPC's error
 * codes are mapped to copy here. On success the produto's termos query is
 * invalidated so "Sua sugestão pendente" appears without a refresh.
 */
export function useSugerirTermoBusca(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sugerir = useCallback(
    async (produto: string, termo: string): Promise<boolean> => {
      if (sending || !sessionToken) return false;
      setSending(true);
      setErrorMessage(null);

      try {
        const { error } = await supabase.rpc("sugerir_termo_busca", {
          p_session_token: sessionToken,
          p_produto: produto,
          p_termo: termo,
        });
        if (error) throw error;

        await queryClient.invalidateQueries({ queryKey: produtoTermosBuscaQueryKey(produto) });
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getTermoBuscaErrorMessage(error));
        return false;
      } finally {
        setSending(false);
      }
    },
    [sending, sessionToken, queryClient, handleSessionError],
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return { sending, errorMessage, clearError, sugerir };
}
