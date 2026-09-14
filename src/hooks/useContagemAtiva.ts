import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isContagemAtivaLinha } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const CONTAGEM_ATIVA_QUERY_KEY = ["contagem-ativa"] as const;

export interface ContagemAtivaValor {
  pacotes_fechados: number;
  unidades_avulsas: number;
}

export interface ContagemAtiva {
  idContagem: string;
  iniciadoPorNome: string;
  iniciadoEm: string;
  valores: Record<string, ContagemAtivaValor>;
}

async function fetchContagemAtiva(sessionToken: string): Promise<ContagemAtiva> {
  const { data, error } = await supabase.rpc("get_or_start_contagem_ativa", {
    p_session_token: sessionToken,
  });

  if (error) throw error;

  const rows = (Array.isArray(data) ? data : []).filter(isContagemAtivaLinha);
  const [header] = rows;
  if (!header) throw new Error("get_or_start_contagem_ativa returned no rows");

  const valores: Record<string, ContagemAtivaValor> = {};
  for (const row of rows) {
    if (row.id_item === null) continue;
    valores[row.id_item] = {
      pacotes_fechados: row.pacotes_fechados ?? 0,
      unidades_avulsas: row.unidades_avulsas ?? 0,
    };
  }

  return {
    idContagem: header.id_contagem,
    iniciadoPorNome: header.iniciado_por_nome,
    iniciadoEm: header.iniciado_em,
    valores,
  };
}

/**
 * Milestone 4D.1 — draft resume. Fetches the single em_andamento packaging
 * count, creating it server-side if none exists (get_or_start_contagem_ativa
 * enforces "one active count" via a partial unique index, not this hook).
 * Any authorized employee gets back the same draft and its autosaved
 * progress, whoever started it.
 */
export function useContagemAtiva(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: CONTAGEM_ATIVA_QUERY_KEY,
    queryFn: () => fetchContagemAtiva(sessionToken as string),
    enabled: sessionToken !== null,
    // The active draft can be changed by any employee at any time (that's
    // the whole point of "resume"), so a value cached from a previous visit
    // must never be shown again — gcTime: 0 drops it the instant this
    // screen is left, forcing a genuine fetch (and a real isLoading state)
    // on every return instead of briefly re-rendering stale field values
    // before a background refetch quietly corrects them.
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
