import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isListaVezEntry, type ListaVezEntry } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function listaVezQueryKey(funcionarioId: string) {
  return ["lista-vez", funcionarioId] as const;
}

async function fetchListaVez(sessionToken: string): Promise<ListaVezEntry[]> {
  const { data, error } = await supabase.rpc("get_lista_vez_estado", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isListaVezEntry);
}

/**
 * funcionarioId is used only as a stable, human-readable cache key (safe for
 * non-privileged purposes). The actual privileged RPC call is authorized
 * exclusively by sessionToken — the server derives id_funcionario from it.
 *
 * Polls every 5s so simultaneous devices/tabs (the realistic multi-employee
 * test scenario) see queue changes made by others without a realtime
 * subscription — there is no existing realtime infrastructure in this
 * project to build on for Milestone 1.
 */
export function useListaVez(funcionarioId: string | null, sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: funcionarioId ? listaVezQueryKey(funcionarioId) : ["lista-vez", null],
    queryFn: () => fetchListaVez(sessionToken as string),
    enabled: funcionarioId !== null && sessionToken !== null,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}

export { listaVezQueryKey };
