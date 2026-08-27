import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isContagemCatalogoItem,
  type ContagemCatalogoItem,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

const CONTAGEM_CATALOGO_QUERY_KEY = ["contagem-catalogo"] as const;

async function fetchContagemCatalogo(sessionToken: string): Promise<ContagemCatalogoItem[]> {
  const { data, error } = await supabase.rpc("get_contagem_catalogo", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isContagemCatalogoItem);
}

/**
 * The active packaging catalog (item, label, package size, order). Package
 * sizes are data, not code — this hook simply renders whatever the RPC
 * returns. A published catalog does not change during a session, so no
 * polling.
 */
export function useContagemCatalogo(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: CONTAGEM_CATALOGO_QUERY_KEY,
    queryFn: () => fetchContagemCatalogo(sessionToken as string),
    enabled: sessionToken !== null,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
