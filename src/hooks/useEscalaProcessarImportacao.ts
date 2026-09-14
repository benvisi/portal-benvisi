import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ESCALA_ADMIN_ERRO_MESSAGE } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import {
  isEscalaImportacaoResultado,
  type EscalaImportacaoResultado,
} from "@/integrations/supabase/contracts";
import { ESCALA_PUBLICACOES_HISTORICO_QUERY_KEY } from "@/hooks/useEscalaPublicacoesHistorico";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

export interface ProcessarImportacaoInput {
  mesReferencia: string;
  nomeArquivo: string;
  funcionariosPlanilha: string[];
  entradas: { nome_planilha: string; data: string; valor: string }[];
  publicar: boolean;
}

/**
 * Administrador-only: calls escala_processar_importacao, the single
 * authoritative validate/diff/publish RPC. Called once with publicar=false
 * for the preview/diff screen and again with publicar=true to publish — both
 * calls re-run the exact same server-side validation from scratch, so there
 * is no separate "trust the earlier preview" path.
 */
export function useEscalaProcessarImportacao(sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [processando, setProcessando] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const processar = useCallback(
    async (input: ProcessarImportacaoInput): Promise<EscalaImportacaoResultado | null> => {
      if (!sessionToken || processando) return null;
      setProcessando(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc("escala_processar_importacao", {
          p_session_token: sessionToken,
          p_mes_referencia: input.mesReferencia,
          p_nome_arquivo: input.nomeArquivo,
          p_funcionarios_planilha: input.funcionariosPlanilha,
          p_entradas: input.entradas,
          p_publicar: input.publicar,
        });

        if (error) throw error;
        if (!isEscalaImportacaoResultado(data)) {
          throw new Error("escala_processar_importacao returned an unexpected shape");
        }

        if (input.publicar && data.status === "publicado") {
          await queryClient.invalidateQueries({ queryKey: ESCALA_PUBLICACOES_HISTORICO_QUERY_KEY });
        }

        return data;
      } catch (error) {
        console.error("[useEscalaProcessarImportacao] escala_processar_importacao failed:", error);
        if (handleSessionError(error)) return null;
        setErrorMessage(ESCALA_ADMIN_ERRO_MESSAGE);
        return null;
      } finally {
        setProcessando(false);
      }
    },
    [sessionToken, processando, queryClient, handleSessionError],
  );

  return { processando, errorMessage, processar };
}
