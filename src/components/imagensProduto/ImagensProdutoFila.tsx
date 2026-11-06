import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IMAGENS_PRODUTO_ADQUIRIDO_PREFIX,
  IMAGENS_PRODUTO_COR_PREFIX,
  IMAGENS_PRODUTO_ERRO_CARREGAR_MESSAGE,
  IMAGENS_PRODUTO_FILA_VAZIO_MESSAGE,
  IMAGENS_PRODUTO_REVISAR_LABEL,
  IMAGENS_PRODUTO_SEM_NOME_LABEL,
  IMAGENS_PRODUTO_STATUS_PENDENTE_LABEL,
  IMAGENS_PRODUTO_TENTAR_NOVAMENTE_LABEL,
} from "@/config/constants";
import type { CandidatoImagemPendente } from "@/integrations/supabase/contracts";
import { formatManaus } from "@/lib/session";

interface ImagensProdutoFilaProps {
  candidatos: CandidatoImagemPendente[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelecionar: (id: string) => void;
}

/** Pending review queue; one row per produto/cor candidate. */
export function ImagensProdutoFila({
  candidatos,
  isLoading,
  isError,
  onRetry,
  onSelecionar,
}: ImagensProdutoFilaProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-destructive">{IMAGENS_PRODUTO_ERRO_CARREGAR_MESSAGE}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          {IMAGENS_PRODUTO_TENTAR_NOVAMENTE_LABEL}
        </Button>
      </div>
    );
  }

  if (!candidatos || candidatos.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {IMAGENS_PRODUTO_FILA_VAZIO_MESSAGE}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {candidatos.map((candidato) => (
        <li key={candidato.id}>
          <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-semibold text-foreground">
                {candidato.produto} · {candidato.cor_codigo}
              </span>
              <span className="text-sm text-foreground">
                {candidato.lacoste_product_name ?? IMAGENS_PRODUTO_SEM_NOME_LABEL}
              </span>
              {candidato.lacoste_color_label && (
                <span className="text-xs text-muted-foreground">
                  {IMAGENS_PRODUTO_COR_PREFIX}: {candidato.lacoste_color_label}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {IMAGENS_PRODUTO_ADQUIRIDO_PREFIX} {formatManaus(candidato.criado_em)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{IMAGENS_PRODUTO_STATUS_PENDENTE_LABEL}</Badge>
              <Button
                type="button"
                className="min-touch"
                onClick={() => onSelecionar(candidato.id)}
              >
                {IMAGENS_PRODUTO_REVISAR_LABEL}
              </Button>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
