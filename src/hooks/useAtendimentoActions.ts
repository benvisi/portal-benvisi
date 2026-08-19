import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ATENDIMENTO_GENERIC_ERROR_MESSAGE } from "@/config/constants";
import { isAtendimentoIniciado } from "@/integrations/supabase/contracts";
import { atendimentoAtivoQueryKey } from "@/hooks/useAtendimentoAtivo";
import { listaVezQueryKey } from "@/hooks/useListaVez";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import {
  getAtendimentoErrorMessage,
  isForaDeOrdemConfirmationRequired,
} from "@/lib/atendimento-error";

export type IniciarAtendimentoResult = "ok" | "requires_confirmation" | "error";

export interface ClienteOutcomeInput {
  id_motivo: string;
  detalhe: string | null;
}

async function iniciarAtendimentoRpc(sessionToken: string, confirmarForaDeOrdem: boolean) {
  const { data, error } = await supabase.rpc("iniciar_atendimento", {
    p_session_token: sessionToken,
    p_confirmar_fora_de_ordem: confirmarForaDeOrdem,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const row = rows[0];
  if (row === undefined || !isAtendimentoIniciado(row)) {
    throw new Error("iniciar_atendimento returned no Atendimento row");
  }
  return row;
}

/**
 * Bundles every Atendimento mutation (start, cancel-provisional, enter
 * closing, abandon closing, final submission) behind one submitting/error
 * state, mirroring useShiftStart's shape. Every successful call invalidates
 * both the active-Atendimento and Lista da Vez queries for this employee,
 * since all of these RPCs change at least one of those.
 */
export function useAtendimentoActions(funcionarioId: string | null, sessionToken: string | null) {
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
        console.error(`[useAtendimentoActions] ${errorLabel} failed:`, error);
        if (handleSessionError(error)) return false;
        setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, invalidate, handleSessionError],
  );

  const iniciar = useCallback(
    async (confirmarForaDeOrdem: boolean): Promise<IniciarAtendimentoResult> => {
      if (submitting || !sessionToken) return "error";
      setSubmitting(true);
      setErrorMessage(null);

      try {
        await iniciarAtendimentoRpc(sessionToken, confirmarForaDeOrdem);
        invalidate();
        return "ok";
      } catch (error) {
        console.error("[useAtendimentoActions] iniciar_atendimento failed:", error);
        if (handleSessionError(error)) return "error";
        if (isForaDeOrdemConfirmationRequired(error)) {
          // The client's queue snapshot was stale (someone else changed the
          // queue between render and this call) — refresh it and let the
          // caller show the same out-of-turn confirmation it would have
          // shown had the snapshot been fresh, instead of failing silently.
          invalidate();
          return "requires_confirmation";
        }
        setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
        return "error";
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, invalidate, handleSessionError],
  );

  const cancelar = useCallback(
    () =>
      runBooleanRpc(
        "cancelar_atendimento_provisorio",
        { p_session_token: sessionToken },
        "cancelar_atendimento_provisorio",
      ),
    [runBooleanRpc, sessionToken],
  );

  const iniciarFechamento = useCallback(
    () =>
      runBooleanRpc(
        "iniciar_fechamento_atendimento",
        { p_session_token: sessionToken },
        "iniciar_fechamento_atendimento",
      ),
    [runBooleanRpc, sessionToken],
  );

  const voltarAoAtendimento = useCallback(
    () =>
      runBooleanRpc(
        "voltar_ao_atendimento",
        { p_session_token: sessionToken },
        "voltar_ao_atendimento",
      ),
    [runBooleanRpc, sessionToken],
  );

  const concluir = useCallback(
    (clientes: ClienteOutcomeInput[]) =>
      runBooleanRpc(
        "concluir_atendimento",
        { p_session_token: sessionToken, p_clientes: clientes },
        "concluir_atendimento",
      ),
    [runBooleanRpc, sessionToken],
  );

  return {
    submitting,
    errorMessage,
    iniciar,
    cancelar,
    iniciarFechamento,
    voltarAoAtendimento,
    concluir,
  };
}
