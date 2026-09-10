import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isEstoqueProdutoDetalheLinha,
  type EstoqueProdutoDetalheLinha,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function detalheQueryKey(produto: string) {
  return ["estoque-produto", produto] as const;
}

async function fetchProdutoDetalhe(
  sessionToken: string,
  produto: string,
): Promise<EstoqueProdutoDetalheLinha[]> {
  const { data, error } = await supabase.rpc("get_produto_estoque_detalhe", {
    p_session_token: sessionToken,
    p_produto: produto,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.filter(isEstoqueProdutoDetalheLinha);
}

/**
 * Every current colour of one exact produto and its complete applicable size
 * grade, from the latest successful snapshot. An empty array means the
 * produto is not in the current snapshot (rendered as "não encontrado").
 * Ordering, applicable sizes and quantities all come from the backend.
 */
export function useProdutoEstoqueDetalhe(sessionToken: string | null, produto: string | null) {
  const handleSessionError = useSessionErrorHandler();
  const produtoLimpo = produto?.trim() ?? "";
  const enabled = sessionToken !== null && produtoLimpo.length > 0;

  const query = useQuery({
    queryKey: detalheQueryKey(produtoLimpo),
    queryFn: () => fetchProdutoDetalhe(sessionToken as string, produtoLimpo),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
