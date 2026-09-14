import { useCallback, useState } from "react";

import { CONTAGEM_SALVAR_ERRO_MESSAGE } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import type { ContagemItemPayload } from "@/hooks/useFinalizarContagem";

/**
 * Milestone 4D.1 — explicit "Salvar" action (autosave was tried and dropped
 * as unreliable in practice; a button the employee presses is simpler to
 * reason about). Upserts whatever the employee has filled in so far into
 * the active draft; unlike finalizar_contagem there is no completeness
 * requirement, so the caller sends only the items that currently have a
 * value.
 */
export function useSalvarProgressoContagem(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const salvar = useCallback(
    async (idContagem: string, itens: readonly ContagemItemPayload[]): Promise<boolean> => {
      if (saving || !sessionToken || itens.length === 0) return false;
      setSaving(true);
      setErrorMessage(null);

      try {
        const { error } = await supabase.rpc("salvar_progresso_contagem", {
          p_session_token: sessionToken,
          p_id_contagem: idContagem,
          p_itens: itens,
        });

        if (error) throw error;
        return true;
      } catch (error) {
        console.error("[useSalvarProgressoContagem] salvar_progresso_contagem failed:", error);
        if (handleSessionError(error)) return false;
        setErrorMessage(CONTAGEM_SALVAR_ERRO_MESSAGE);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [saving, sessionToken, handleSessionError],
  );

  return {
    saving,
    errorMessage,
    salvar,
    clearError: useCallback(() => setErrorMessage(null), []),
  };
}
