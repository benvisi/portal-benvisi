import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { LimpezaTarefa, LimpezaTurno } from "@/integrations/supabase/contracts";
import { limpezaAtribuicoesMesQueryKey } from "@/hooks/useLimpezaAtribuicoesMes";
import { limpezaDiaQueryKey } from "@/hooks/useLimpezaDia";
import { limpezaGerencialMesQueryKey } from "@/hooks/useLimpezaGerencialMes";
import { limpezaMesQueryKey } from "@/hooks/useLimpezaMes";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getLimpezaManualErrorMessage } from "@/lib/limpeza";

/**
 * Gerente/Administrador manual override (limpeza_definir_atribuicao_manual).
 * Locks the slot against ordinary automatic recalculation server-side.
 */
export function useLimpezaAtribuirManual(sessionToken: string | null, mes: string) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const atribuir = useCallback(
    async (
      data: string,
      turno: LimpezaTurno,
      tarefa: LimpezaTarefa,
      funcionarioId: string,
    ): Promise<boolean> => {
      if (!sessionToken || saving) return false;
      setSaving(true);
      setErrorMessage(null);

      try {
        const { error } = await supabase.rpc("limpeza_definir_atribuicao_manual", {
          p_session_token: sessionToken,
          p_data: data,
          p_turno: turno,
          p_tarefa: tarefa,
          p_funcionario_id: funcionarioId,
        });
        if (error) throw error;

        await queryClient.invalidateQueries({ queryKey: limpezaDiaQueryKey(data) });
        await queryClient.invalidateQueries({ queryKey: limpezaMesQueryKey(mes) });
        await queryClient.invalidateQueries({ queryKey: limpezaGerencialMesQueryKey(mes) });
        await queryClient.invalidateQueries({ queryKey: limpezaAtribuicoesMesQueryKey(mes) });
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getLimpezaManualErrorMessage(error));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [sessionToken, saving, queryClient, mes, handleSessionError],
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return { saving, errorMessage, clearError, atribuir };
}
