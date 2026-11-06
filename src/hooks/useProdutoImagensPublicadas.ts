import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { PRODUTO_IMAGENS_BUCKET } from "@/config/constants";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { supabase } from "@/integrations/supabase/client";
import {
  isProdutoImagemPublicada,
  type ProdutoImagemPublicada,
} from "@/integrations/supabase/contracts";
import { agruparImagensPorCor } from "@/lib/produtoImagensPublicadas";

async function fetchImagensPublicadas(
  sessionToken: string,
  produto: string,
): Promise<ProdutoImagemPublicada[]> {
  const { data, error } = await supabase.rpc("get_produto_imagens_publicadas", {
    p_session_token: sessionToken,
    p_produto: produto,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter(isProdutoImagemPublicada);
}

function buildPublicUrl(storagePath: string): string {
  return supabase.storage.from(PRODUTO_IMAGENS_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

/**
 * Active published images of one produto, grouped by colour. One light
 * metadata request per produto; the image files themselves load only when the
 * viewer opens. A failure here is non-fatal for the stock lookup: the matrix
 * simply shows no icons.
 */
export function useProdutoImagensPublicadas(sessionToken: string | null, produto: string | null) {
  const handleSessionError = useSessionErrorHandler();
  const produtoLimpo = produto?.trim() ?? "";

  const query = useQuery({
    queryKey: ["estoque-produto-imagens", produtoLimpo] as const,
    queryFn: () => fetchImagensPublicadas(sessionToken as string, produtoLimpo),
    enabled: sessionToken !== null && produtoLimpo.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return useMemo(() => agruparImagensPorCor(query.data ?? [], buildPublicUrl), [query.data]);
}
