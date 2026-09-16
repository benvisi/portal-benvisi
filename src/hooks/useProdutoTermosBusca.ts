import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isProdutoTermoBusca, type ProdutoTermoBusca } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function produtoTermosBuscaQueryKey(produto: string) {
  return ["estoque-produto-termos", produto] as const;
}

/**
 * Employee view of one produto's termos de busca: every approved term plus
 * the caller's own pending suggestions (the RPC never returns anyone else's
 * pending/rejected rows or deactivated history).
 */
export function useProdutoTermosBusca(sessionToken: string | null, produto: string | null) {
  const handleSessionError = useSessionErrorHandler();
  const produtoLimpo = produto?.trim() ?? "";
  const enabled = sessionToken !== null && produtoLimpo.length > 0;

  const query = useQuery({
    queryKey: produtoTermosBuscaQueryKey(produtoLimpo),
    queryFn: async (): Promise<ProdutoTermoBusca[]> => {
      const { data, error } = await supabase.rpc("get_produto_termos_busca", {
        p_session_token: sessionToken as string,
        p_produto: produtoLimpo,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows.filter(isProdutoTermoBusca);
    },
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
