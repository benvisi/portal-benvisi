import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isLimpezaSyncPendencia,
  type LimpezaSyncPendencia,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const limpezaSyncPendenciasQueryKey = ["limpeza-sync-pendencias"] as const;

async function fetchLimpezaSyncPendencias(sessionToken: string): Promise<LimpezaSyncPendencia[]> {
  const { data, error } = await supabase.rpc("get_limpeza_sync_pendencias", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.filter(isLimpezaSyncPendencia) : [];
}

/**
 * Gerente/Administrador-only: dates where an Escala-publish-triggered (or
 * manual) Limpeza sync failed and hasn't succeeded since. Escala publication
 * always succeeds regardless (20260925_103) — this is purely the visibility
 * layer for that swallowed failure, so management knows the manual
 * "Sincronizar" fallback is actually needed.
 */
export function useLimpezaSyncPendencias(sessionToken: string | null, enabled: boolean) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: limpezaSyncPendenciasQueryKey,
    queryFn: () => fetchLimpezaSyncPendencias(sessionToken as string),
    enabled: enabled && sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
