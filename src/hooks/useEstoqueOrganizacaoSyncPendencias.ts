import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isEstoqueOrganizacaoSyncPendencia,
  type EstoqueOrganizacaoSyncPendencia,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const estoqueOrganizacaoSyncPendenciasQueryKey = [
  "estoque-organizacao-sync-pendencias",
] as const;

async function fetchEstoqueOrganizacaoSyncPendencias(
  sessionToken: string,
): Promise<EstoqueOrganizacaoSyncPendencia[]> {
  const { data, error } = await supabase.rpc("get_estoque_organizacao_sync_pendencias", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.filter(isEstoqueOrganizacaoSyncPendencia) : [];
}

/**
 * Gerente/Administrador-only: weeks where an Escala-publish-triggered (or
 * manual) stockroom sync failed and hasn't succeeded since. Escala
 * publication always succeeds regardless (20260927_103) — this is purely
 * the visibility layer for that swallowed failure.
 */
export function useEstoqueOrganizacaoSyncPendencias(sessionToken: string | null, enabled: boolean) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: estoqueOrganizacaoSyncPendenciasQueryKey,
    queryFn: () => fetchEstoqueOrganizacaoSyncPendencias(sessionToken as string),
    enabled: enabled && sessionToken !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
