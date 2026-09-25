import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { limpezaGerencialMesQueryKey } from "@/hooks/useLimpezaGerencialMes";
import { limpezaMesQueryKey } from "@/hooks/useLimpezaMes";
import { limpezaSyncPendenciasQueryKey } from "@/hooks/useLimpezaSyncPendencias";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getLimpezaManualErrorMessage } from "@/lib/limpeza";

/**
 * Gerente/Administrador fallback resync (limpeza_sincronizar_manual) — the
 * Gerenciar tab's "Sincronizar" action. Ordinary Limpeza reads never sync on
 * their own (see 20260925_102's header comment); the primary sync path is
 * the Escala publish hook (20260925_103). This is the manual recovery path
 * if that publish-time sync ever failed silently or drift is suspected.
 */
export function useLimpezaSincronizarManual(sessionToken: string | null, mes: string) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sincronizar = useCallback(async (): Promise<boolean> => {
    if (!sessionToken || syncing) return false;
    setSyncing(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.rpc("limpeza_sincronizar_manual", {
        p_session_token: sessionToken,
        p_mes: mes,
      });
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ["limpeza-dia"] });
      await queryClient.invalidateQueries({ queryKey: limpezaMesQueryKey(mes) });
      await queryClient.invalidateQueries({ queryKey: limpezaGerencialMesQueryKey(mes) });
      await queryClient.invalidateQueries({ queryKey: limpezaSyncPendenciasQueryKey });
      return true;
    } catch (error) {
      if (handleSessionError(error)) return false;
      setErrorMessage(getLimpezaManualErrorMessage(error));
      return false;
    } finally {
      setSyncing(false);
    }
  }, [sessionToken, syncing, queryClient, mes, handleSessionError]);

  return { syncing, errorMessage, sincronizar };
}
