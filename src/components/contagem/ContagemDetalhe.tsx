import { ArrowLeft, Loader2 } from "lucide-react";

import { ContagemDetalheTabela } from "@/components/contagem/ContagemDetalheTabela";
import { ContagemStatusBadge } from "@/components/contagem/ContagemStatusBadge";
import { Button } from "@/components/ui/button";
import {
  CONTAGEM_DETALHE_ERRO_MESSAGE,
  CONTAGEM_MARCANDO_REVISADA_LABEL,
  CONTAGEM_MARCAR_REVISADA_LABEL,
  CONTAGEM_OBSERVACAO_LABEL,
  CONTAGEM_PREENCHIDO_POR_PREFIX,
  CONTAGEM_REVISADO_POR_PREFIX,
  CONTAGEM_VOLTAR_LISTA_LABEL,
} from "@/config/constants";
import { useContagemDetalhe } from "@/hooks/useContagemDetalhe";
import { useMarcarContagemRevisada } from "@/hooks/useMarcarContagemRevisada";
import { formatContagemDataHora } from "@/lib/contagem";

interface ContagemDetalheProps {
  sessionToken: string;
  contagemId: string;
  /** Show "Marcar como revisada" (only meaningful for a pending submission). */
  permitirRevisar: boolean;
  onVoltar: () => void;
}

/**
 * Full breakdown of one submission: who submitted it and when, the
 * observation if any, the per-item table, and — for a pending submission
 * opened from the review queue — the "Marcar como revisada" action.
 */
export function ContagemDetalhe({
  sessionToken,
  contagemId,
  permitirRevisar,
  onVoltar,
}: ContagemDetalheProps) {
  const query = useContagemDetalhe(sessionToken, contagemId);
  const { marking, errorMessage, marcarRevisada } = useMarcarContagemRevisada(sessionToken);

  const linhas = query.data ?? [];
  const cabecalho = linhas[0] ?? null;

  async function handleRevisar() {
    const ok = await marcarRevisada(contagemId);
    if (ok) onVoltar();
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-touch w-fit gap-2 px-2 text-muted-foreground hover:text-foreground"
        onClick={onVoltar}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {CONTAGEM_VOLTAR_LISTA_LABEL}
      </Button>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : query.isError || !cabecalho ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-destructive">{CONTAGEM_DETALHE_ERRO_MESSAGE}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">
                  {formatContagemDataHora(cabecalho.submetido_em)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {CONTAGEM_PREENCHIDO_POR_PREFIX} {cabecalho.submetido_por_nome}
                </span>
                {cabecalho.status === "revisada" && cabecalho.revisada_por_nome && (
                  <span className="text-xs text-muted-foreground">
                    {CONTAGEM_REVISADO_POR_PREFIX} {cabecalho.revisada_por_nome}
                    {cabecalho.revisada_em
                      ? ` · ${formatContagemDataHora(cabecalho.revisada_em)}`
                      : ""}
                  </span>
                )}
              </div>
              <ContagemStatusBadge status={cabecalho.status} />
            </div>

            {cabecalho.observacao && (
              <div className="flex flex-col gap-0.5 border-t border-border/60 pt-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {CONTAGEM_OBSERVACAO_LABEL}
                </span>
                <p className="whitespace-pre-line text-sm text-foreground">
                  {cabecalho.observacao}
                </p>
              </div>
            )}
          </div>

          <ContagemDetalheTabela linhas={linhas} />

          {permitirRevisar && cabecalho.status === "pendente_revisao" && (
            <div className="flex flex-col gap-2">
              {errorMessage && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              )}
              <Button
                type="button"
                className="min-touch w-full"
                disabled={marking}
                onClick={() => void handleRevisar()}
              >
                {marking ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {CONTAGEM_MARCANDO_REVISADA_LABEL}
                  </span>
                ) : (
                  CONTAGEM_MARCAR_REVISADA_LABEL
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
