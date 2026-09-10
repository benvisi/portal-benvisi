import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { ESTOQUE_BUSCA_MIN_CHARS } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { isEstoqueProdutoBusca, type EstoqueProdutoBusca } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function buscaQueryKey(termo: string) {
  return ["estoque-busca", termo] as const;
}

async function fetchProdutosEstoque(
  sessionToken: string,
  termo: string,
): Promise<EstoqueProdutoBusca[]> {
  const { data, error } = await supabase.rpc("buscar_produtos_estoque", {
    p_session_token: sessionToken,
    p_termo: termo,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isEstoqueProdutoBusca);
}

/**
 * Primary produto lookup. The backend does prefix matching on `produto`
 * (ranked first) plus a secondary partial `desc_produto` match — no fuzzy
 * search, no client-side inventory scan. The caller is expected to pass an
 * already-debounced term; terms shorter than the minimum are not queried
 * (the RPC also returns nothing for them).
 */
export function useBuscarProdutosEstoque(sessionToken: string | null, termo: string) {
  const handleSessionError = useSessionErrorHandler();
  const termoLimpo = termo.trim();
  const enabled = sessionToken !== null && termoLimpo.length >= ESTOQUE_BUSCA_MIN_CHARS;

  const query = useQuery({
    queryKey: buscaQueryKey(termoLimpo),
    queryFn: () => fetchProdutosEstoque(sessionToken as string, termoLimpo),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return { ...query, enabled };
}
