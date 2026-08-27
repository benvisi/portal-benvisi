import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isContagemDetalheLinha,
  type ContagemDetalheLinha,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function contagemDetalheQueryKey(id: string) {
  return ["contagem-detalhe", id] as const;
}

async function fetchContagemDetalhe(
  sessionToken: string,
  id: string,
): Promise<ContagemDetalheLinha[]> {
  const { data, error } = await supabase.rpc("get_contagem_detalhe", {
    p_session_token: sessionToken,
    p_id: id,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isContagemDetalheLinha);
}

/**
 * Administrador-only: every item line of one submission, in catalog order,
 * each row also carrying the submission-header fields. `id` null keeps the
 * query idle (no submission selected).
 */
export function useContagemDetalhe(sessionToken: string | null, id: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: contagemDetalheQueryKey(id ?? "none"),
    queryFn: () => fetchContagemDetalhe(sessionToken as string, id as string),
    enabled: sessionToken !== null && id !== null,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
