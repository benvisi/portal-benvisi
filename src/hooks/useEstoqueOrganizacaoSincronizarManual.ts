import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { estoqueOrganizacaoSemanaQueryKey } from "@/hooks/useEstoqueOrganizacaoSemana";
import { estoqueOrganizacaoSyncPendenciasQueryKey } from "@/hooks/useEstoqueOrganizacaoSyncPendencias";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getEstoqueOrganizacaoManualErrorMessage } from "@/lib/estoqueOrganizacao";
import { monthStartISO } from "@/lib/escala";

/**
 * Gerente/Administrador fallback resync (estoque_organizacao_sincronizar_manual)
 * — the Gerenciar tab's "Sincronizar" action, mirroring Limpeza's. The
 * primary sync path is the Escala publish hook; this recovers from a
 * publish-time sync that failed silently. Takes the month containing the
 * selected week (the RPC itself resyncs every week overlapping that month).
 */
export function useEstoqueOrganizacaoSincronizarManual(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sincronizar = useCallback(
    async (semanaInicio: string): Promise<boolean> => {
      if (!sessionToken || syncing) return false;
      setSyncing(true);
      setErrorMessage(null);

      try {
        const { error } = await supabase.rpc("estoque_organizacao_sincronizar_manual", {
          p_session_token: sessionToken,
          p_mes: monthStartISO(semanaInicio),
        });
        if (error) throw error;

        await queryClient.invalidateQueries({ queryKey: estoqueOrganizacaoSemanaQueryKey });
        await queryClient.invalidateQueries({ queryKey: ["estoque-organizacao-gerencial-semana"] });
        await queryClient.invalidateQueries({ queryKey: estoqueOrganizacaoSyncPendenciasQueryKey });
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getEstoqueOrganizacaoManualErrorMessage(error));
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [sessionToken, syncing, queryClient, handleSessionError],
  );

  return { syncing, errorMessage, sincronizar };
}
