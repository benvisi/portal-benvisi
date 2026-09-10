import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isEstoqueFreshness } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

const ESTOQUE_FRESHNESS_QUERY_KEY = ["estoque-freshness"] as const;

/**
 * Completion timestamp (ISO string) of the latest successful complete
 * inventory sync, or null when no successful sync exists yet. A
 * failed/in-progress execution never contributes here — the RPC only reads
 * successful, completed syncs.
 */
async function fetchEstoqueFreshness(sessionToken: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_estoque_freshness", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const row = rows.find(isEstoqueFreshness);
  return row ? row.sync_concluido_em : null;
}

export function useEstoqueFreshness(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: ESTOQUE_FRESHNESS_QUERY_KEY,
    queryFn: () => fetchEstoqueFreshness(sessionToken as string),
    enabled: sessionToken !== null,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
