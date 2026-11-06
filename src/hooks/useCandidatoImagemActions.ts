import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY } from "@/hooks/useCandidatosImagemPendentes";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { getImagensProdutoErrorMessage, type SelecaoImagens } from "@/lib/produtoImagens";

/**
 * Review mutations: aprovar_candidato_imagem and rejeitar_candidato_imagem.
 * Approval only records the human decision (it creates a PENDING publication
 * for the worker); nothing here uploads or publishes an image. The browser
 * never sends p_confirmar_divergencia: it has no effect server-side and the
 * ineligible-image rule has no override.
 *
 * A ref (not state) guards double submission so two calls in the same tick
 * cannot both reach the RPC. Success is only reported once the RPC resolves
 * without error, after which the queue is refetched.
 */
export function useCandidatoImagemActions(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const run = useCallback(
    async (call: () => Promise<boolean>): Promise<boolean> => {
      if (inFlight.current || !sessionToken) return false;
      inFlight.current = true;
      setBusy(true);
      setErrorMessage(null);
      try {
        const ok = await call();
        if (!ok) throw new Error("review RPC did not report success");
        await queryClient.invalidateQueries({ queryKey: CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY });
        return true;
      } catch (error) {
        if (handleSessionError(error)) return false;
        setErrorMessage(getImagensProdutoErrorMessage(error));
        // The queue may be stale (e.g. already reviewed elsewhere).
        void queryClient.invalidateQueries({ queryKey: CANDIDATOS_IMAGEM_PENDENTES_QUERY_KEY });
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [sessionToken, queryClient, handleSessionError],
  );

  const aprovar = useCallback(
    (candidatoId: string, selecao: SelecaoImagens, observacao: string) =>
      run(async () => {
        if (selecao.principal === null) throw new Error("primary image not selected");
        const { data, error } = await supabase.rpc("aprovar_candidato_imagem", {
          p_session_token: sessionToken as string,
          p_candidato_id: candidatoId,
          p_indice_principal: selecao.principal,
          p_indice_secundaria: selecao.secundaria,
          p_observacao: observacao.trim() || null,
        });
        if (error) throw error;
        return typeof data === "string" && data.length > 0;
      }),
    [run, sessionToken],
  );

  const rejeitar = useCallback(
    (candidatoId: string, motivo: string) =>
      run(async () => {
        const { error } = await supabase.rpc("rejeitar_candidato_imagem", {
          p_session_token: sessionToken as string,
          p_candidato_id: candidatoId,
          p_observacao: motivo.trim(),
        });
        if (error) throw error;
        return true;
      }),
    [run, sessionToken],
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return { busy, errorMessage, clearError, aprovar, rejeitar };
}
