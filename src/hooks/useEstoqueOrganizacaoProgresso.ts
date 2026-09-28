import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isEstoqueOrganizacaoProgresso } from "@/integrations/supabase/contracts";
import { estoqueOrganizacaoSemanaQueryKey } from "@/hooks/useEstoqueOrganizacaoSemana";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getEstoqueOrganizacaoProgressoErrorMessage } from "@/lib/estoqueOrganizacao";

/**
 * Autosave progress (0-5) on the caller's own estante this week, plus the
 * one-click "Concluir estante" convenience action. Both RPCs set an
 * absolute count (never increment/decrement), so a slow network retry or
 * double-tap is naturally idempotent. Server rejects the update once the
 * assignment's week is no longer current (SEMANA_ENCERRADA) or the caller
 * doesn't own the assignment (SEM_PERMISSAO_ESTOQUE_ORGANIZACAO) — no
 * manager-completes-on-behalf in V1.
 */
export function useEstoqueOrganizacaoProgresso() {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const salvar = useCallback(
    async (
      sessionToken: string | null,
      rpc: "atualizar" | "concluir",
      atribuicaoId: string,
      prateleirasConcluidas?: number,
    ): Promise<boolean> => {
      if (!sessionToken || pendingId !== null) return false;
      setPendingId(atribuicaoId);
      setErrorMessage(null);

      try {
        const { data: result, error } =
          rpc === "concluir"
            ? await supabase.rpc("estoque_organizacao_concluir_estante", {
                p_session_token: sessionToken,
                p_atribuicao_id: atribuicaoId,
              })
            : await supabase.rpc("estoque_organizacao_atualizar_progresso", {
                p_session_token: sessionToken,
                p_atribuicao_id: atribuicaoId,
                p_prateleiras_concluidas: prateleirasConcluidas,
              });
        if (error) throw error;

        const row = Array.isArray(result) ? result[0] : result;
        if (!isEstoqueOrganizacaoProgresso(row)) throw new Error("RESPOSTA_INVALIDA");

        await queryClient.invalidateQueries({ queryKey: estoqueOrganizacaoSemanaQueryKey });
        await queryClient.invalidateQueries({ queryKey: ["estoque-organizacao-gerencial-semana"] });
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getEstoqueOrganizacaoProgressoErrorMessage(error));
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, queryClient, handleSessionError],
  );

  const atualizarProgresso = useCallback(
    (sessionToken: string | null, atribuicaoId: string, prateleirasConcluidas: number) =>
      salvar(sessionToken, "atualizar", atribuicaoId, prateleirasConcluidas),
    [salvar],
  );

  const concluirEstante = useCallback(
    (sessionToken: string | null, atribuicaoId: string) =>
      salvar(sessionToken, "concluir", atribuicaoId),
    [salvar],
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return { pendingId, errorMessage, clearError, atualizarProgresso, concluirEstante };
}
