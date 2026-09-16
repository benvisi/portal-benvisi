import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { produtoTermosBuscaQueryKey } from "@/hooks/useProdutoTermosBusca";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { TERMOS_BUSCA_PENDENTES_QUERY_KEY } from "@/hooks/useTermosBuscaPendentes";
import { termosBuscaProdutoAdminQueryKey } from "@/hooks/useTermosBuscaProdutoAdmin";
import { getTermoBuscaErrorMessage } from "@/lib/termosBusca";

export type TermoBuscaAcao = "aprovar" | "rejeitar" | "desativar" | "reativar";

/**
 * Management mutations: moderar_termo_busca (aprovar / editar-e-aprovar /
 * rejeitar / desativar / reativar) and adicionar_termo_busca_admin (direct
 * approved addition). The capability is enforced by the RPCs. Each success
 * invalidates the queue, the produto's admin list and the employee-facing
 * termos list, so changes show everywhere without refresh (search itself
 * reads the table live on every call, so it needs no invalidation). Only
 * one action runs at a time; `busyId` lets the UI disable just the affected
 * row ("novo" while a direct addition is in flight).
 */
export function useTermosBuscaAdminActions(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const invalidate = useCallback(
    (produto: string) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: TERMOS_BUSCA_PENDENTES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: termosBuscaProdutoAdminQueryKey(produto) }),
        queryClient.invalidateQueries({ queryKey: produtoTermosBuscaQueryKey(produto) }),
      ]),
    [queryClient],
  );

  const moderar = useCallback(
    async (
      id: string,
      produto: string,
      acao: TermoBuscaAcao,
      termoFinal?: string,
    ): Promise<boolean> => {
      if (busyId || !sessionToken) return false;
      setBusyId(id);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc("moderar_termo_busca", {
          p_session_token: sessionToken,
          p_id: id,
          p_acao: acao,
          p_termo_final: termoFinal ?? null,
        });
        if (error) throw error;
        if (data !== true) throw new Error("moderar_termo_busca did not report success");

        await invalidate(produto);
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getTermoBuscaErrorMessage(error, true));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, sessionToken, invalidate, handleSessionError],
  );

  const adicionar = useCallback(
    async (produto: string, termo: string): Promise<boolean> => {
      if (busyId || !sessionToken) return false;
      setBusyId("novo");
      setErrorMessage(null);

      try {
        const { error } = await supabase.rpc("adicionar_termo_busca_admin", {
          p_session_token: sessionToken,
          p_produto: produto,
          p_termo: termo,
        });
        if (error) throw error;

        await invalidate(produto);
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getTermoBuscaErrorMessage(error, true));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, sessionToken, invalidate, handleSessionError],
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return { busyId, errorMessage, clearError, moderar, adicionar };
}
