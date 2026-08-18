import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ATENDIMENTO_GENERIC_ERROR_MESSAGE } from "@/config/constants";
import { isAtendimentoAtivo } from "@/integrations/supabase/contracts";
import { atendimentoAtivoQueryKey } from "@/hooks/useAtendimentoAtivo";
import { listaVezQueryKey } from "@/hooks/useListaVez";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import {
  getAtendimentoErrorMessage,
  isForaDeOrdemConfirmationRequired,
} from "@/lib/atendimento-error";

export type IniciarAtendimentoResult = "ok" | "requires_confirmation" | "error";

async function iniciarAtendimentoRpc(sessionToken: string, confirmarForaDeOrdem: boolean) {
  const { data, error } = await supabase.rpc("iniciar_atendimento", {
    p_session_token: sessionToken,
    p_confirmar_fora_de_ordem: confirmarForaDeOrdem,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const row = rows[0];
  if (row === undefined || !isAtendimentoAtivo(row)) {
    throw new Error("iniciar_atendimento returned no Atendimento row");
  }
  return row;
}

/**
 * Bundles the three Atendimento mutations (start, cancel-provisional,
 * complete) behind one submitting/error state, mirroring useShiftStart's
 * shape. Every successful call invalidates both the active-Atendimento and
 * Lista da Vez queries for this employee, since all three RPCs change at
 * least one of those.
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

  const cancelar = useCallback(async (): Promise<boolean> => {
    if (submitting || !sessionToken) return false;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.rpc("cancelar_atendimento_provisorio", {
        p_session_token: sessionToken,
      });
      if (error) throw error;
      if (data !== true) throw new Error("cancelar_atendimento_provisorio did not report success");
      invalidate();
      return true;
    } catch (error) {
      console.error("[useAtendimentoActions] cancelar_atendimento_provisorio failed:", error);
      if (handleSessionError(error)) return false;
      setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [submitting, sessionToken, invalidate, handleSessionError]);

  const concluir = useCallback(async (): Promise<boolean> => {
    if (submitting || !sessionToken) return false;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.rpc("concluir_atendimento", {
        p_session_token: sessionToken,
      });
      if (error) throw error;
      if (data !== true) throw new Error("concluir_atendimento did not report success");
      invalidate();
      return true;
    } catch (error) {
      console.error("[useAtendimentoActions] concluir_atendimento failed:", error);
      if (handleSessionError(error)) return false;
      setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [submitting, sessionToken, invalidate, handleSessionError]);

  return { submitting, errorMessage, iniciar, cancelar, concluir };
}
