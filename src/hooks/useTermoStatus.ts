import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { TERMS_VERSION } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

async function fetchTermoStatus(sessionToken: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_termo_acceptance", {
    p_session_token: sessionToken,
    p_versao_termo: TERMS_VERSION,
  });

  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("check_termo_acceptance returned no boolean");

  return data;
}

/**
 * funcionarioId is used only as a stable, human-readable cache key (safe for
 * non-privileged purposes). The actual privileged RPC call is authorized
 * exclusively by sessionToken — the server derives id_funcionario from it.
 */
export function useTermoStatus(funcionarioId: string | null, sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: ["termo-status", funcionarioId, TERMS_VERSION],
    queryFn: () => fetchTermoStatus(sessionToken as string),
    enabled: funcionarioId !== null && sessionToken !== null,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
