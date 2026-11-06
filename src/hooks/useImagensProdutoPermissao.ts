import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export const IMAGENS_PRODUTO_PERMISSAO_QUERY_KEY = ["imagens-produto-permissao"] as const;

/**
 * Whether the current employee holds funcionarios.pode_gerenciar_imagens_produto.
 * UI gating only (show/hide the entry point and route): every review RPC
 * re-checks the capability server-side regardless of this value.
 */
export function useImagensProdutoPermissao(sessionToken: string | null) {
  const handleSessionError = useSessionErrorHandler();

  const query = useQuery({
    queryKey: IMAGENS_PRODUTO_PERMISSAO_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_produto_imagens_permissao", {
        p_session_token: sessionToken as string,
      });
      if (error) throw error;
      return data === true;
    },
    enabled: sessionToken !== null,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return { ...query, podeGerenciar: query.data === true };
}
