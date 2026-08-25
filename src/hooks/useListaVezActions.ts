import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ATENDIMENTO_GENERIC_ERROR_MESSAGE } from "@/config/constants";
import { atendimentoAtivoQueryKey } from "@/hooks/useAtendimentoAtivo";
import { listaVezQueryKey } from "@/hooks/useListaVez";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getAtendimentoErrorMessage } from "@/lib/atendimento-error";

/**
 * Milestone 2A.2: voluntary leave/rejoin of Lista da Vez plus manager/admin
 * removal of another employee. Kept as its own hook (rather than folded into
 * useAtendimentoActions) since these are queue-membership actions, not
 * Atendimento actions — sair_lista_da_vez/entrar_lista_da_vez never touch
 * public.atendimentos at all, and remover_funcionario_lista_da_vez only ever
 * targets another employee's queue row, never the caller's own. Mirrors
 * useAtendimentoActions' submitting/error/invalidate shape for consistency.
 */
export function useListaVezActions(funcionarioId: string | null, sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    if (!funcionarioId) return;
    void queryClient.invalidateQueries({ queryKey: atendimentoAtivoQueryKey(funcionarioId) });
    void queryClient.invalidateQueries({ queryKey: listaVezQueryKey(funcionarioId) });
  }, [queryClient, funcionarioId]);

  const runBooleanRpc = useCallback(
    async (
      rpcName: string,
      params: Record<string, unknown>,
      errorLabel: string,
    ): Promise<boolean> => {
      if (submitting || !sessionToken) return false;
      setSubmitting(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc(rpcName, params);
        if (error) throw error;
        if (data !== true) throw new Error(`${rpcName} did not report success`);
        invalidate();
        return true;
      } catch (error) {
        console.error(`[useListaVezActions] ${errorLabel} failed:`, error);
        if (handleSessionError(error)) return false;
        setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, invalidate, handleSessionError],
  );

  const sair = useCallback(
    () =>
      runBooleanRpc("sair_lista_da_vez", { p_session_token: sessionToken }, "sair_lista_da_vez"),
    [runBooleanRpc, sessionToken],
  );

  const entrar = useCallback(
    () =>
      runBooleanRpc(
        "entrar_lista_da_vez",
        { p_session_token: sessionToken },
        "entrar_lista_da_vez",
      ),
    [runBooleanRpc, sessionToken],
  );

  const remover = useCallback(
    (idFuncionarioAlvo: string) =>
      runBooleanRpc(
        "remover_funcionario_lista_da_vez",
        { p_session_token: sessionToken, p_id_funcionario_alvo: idFuncionarioAlvo },
        "remover_funcionario_lista_da_vez",
      ),
    [runBooleanRpc, sessionToken],
  );

  return { submitting, errorMessage, sair, entrar, remover };
}
