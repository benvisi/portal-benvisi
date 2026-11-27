import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  isEstoqueCodigoBarraResultado,
  type EstoqueCodigoBarraResultado,
} from "@/integrations/supabase/contracts";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { normalizarCodigoBarra } from "@/lib/codigoBarras";

export function codigoBarraQueryKey(codigo: string) {
  return ["estoque-codigo-barra", codigo] as const;
}

export async function fetchEstoqueCodigoBarra(
  sessionToken: string,
  codigo: string,
): Promise<EstoqueCodigoBarraResultado | null> {
  const { data, error } = await supabase.rpc("get_estoque_por_codigo_barra", {
    p_session_token: sessionToken,
    // Always sent as text — never Number(), so leading zeros survive.
    p_codigo_barra: codigo,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.find(isEstoqueCodigoBarraResultado) ?? null;
}

/**
 * Exact barcode resolution (get_estoque_por_codigo_barra). Runs only for a
 * SUBMITTED code (Enter, USB scanner, camera) — never while typing. The
 * query key is the code itself, so a newer submission always supersedes an
 * older in-flight one (React Query ignores a stale key's late response) and
 * the same code submitted twice shares one request.
 */
export function useEstoqueCodigoBarra(sessionToken: string | null, codigo: string | null) {
  const handleSessionError = useSessionErrorHandler();
  const codigoLimpo = normalizarCodigoBarra(codigo ?? "");
  const enabled = sessionToken !== null && codigoLimpo.length > 0;

  const query = useQuery({
    queryKey: codigoBarraQueryKey(codigoLimpo),
    queryFn: () => fetchEstoqueCodigoBarra(sessionToken as string, codigoLimpo),
    enabled,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  return query;
}
