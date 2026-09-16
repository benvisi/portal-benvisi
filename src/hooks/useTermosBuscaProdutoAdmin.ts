import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isTermoBuscaAdmin, type TermoBuscaAdmin } from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export function termosBuscaProdutoAdminQueryKey(produto: string) {
  return ["termos-busca-admin-produto", produto] as const;
}

/**
 * Management-only: every termo row of one produto, all statuses, with the
 * audit trail. Approved rows come first; the view splits the rest into the
 * collapsed history.
 */
export function useTermosBuscaProdutoAdmin(sessionToken: string | null, produto: string | null) {
  const handleSessionError = useSessionErrorHandler();
  const produtoLimpo = produto?.trim() ?? "";
  const enabled = sessionToken !== null && produtoLimpo.length > 0;

  const query = useQuery({
    queryKey: termosBuscaProdutoAdminQueryKey(produtoLimpo),
    queryFn: async (): Promise<TermoBuscaAdmin[]> => {
      const { data, error } = await supabase.rpc("get_termos_busca_produto_admin", {
        p_session_token: sessionToken as string,
        p_produto: produtoLimpo,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows.filter(isTermoBuscaAdmin);
    },
    enabled,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
