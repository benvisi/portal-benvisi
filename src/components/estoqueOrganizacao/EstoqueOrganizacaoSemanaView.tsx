import { Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ESTOQUE_ORGANIZACAO_CARREGANDO_MESSAGE,
  ESTOQUE_ORGANIZACAO_CONCLUINDO_LABEL,
  ESTOQUE_ORGANIZACAO_CONCLUIR_ESTANTE_LABEL,
  ESTOQUE_ORGANIZACAO_DIRETRIZES,
  ESTOQUE_ORGANIZACAO_DIRETRIZES_TITLE,
  ESTOQUE_ORGANIZACAO_ERRO_MESSAGE,
  ESTOQUE_ORGANIZACAO_SEMANA_HEADER_PREFIX,
  ESTOQUE_ORGANIZACAO_SEMANA_VAZIA_MESSAGE,
  getEstoqueOrganizacaoConcluidoLabel,
  getEstoqueOrganizacaoConcluidoPorLabel,
  getEstoqueOrganizacaoEstanteLabel,
  getEstoqueOrganizacaoPrateleirasLabel,
} from "@/config/constants";
import { formatLimpezaHora } from "@/lib/limpeza";
import { formatSemanaLabel, weekStartISO } from "@/lib/estoqueOrganizacao";
import { getManausDateISO } from "@/lib/escala";
import { useEstoqueOrganizacaoProgresso } from "@/hooks/useEstoqueOrganizacaoProgresso";
import { useEstoqueOrganizacaoSemana } from "@/hooks/useEstoqueOrganizacaoSemana";
import type { EstoqueOrganizacaoAtribuicaoSemana } from "@/integrations/supabase/contracts";

interface EstoqueOrganizacaoSemanaViewProps {
  sessionToken: string | null;
  funcionarioLogadoId: string | null;
}

export function EstoqueOrganizacaoSemanaView({
  sessionToken,
  funcionarioLogadoId,
}: EstoqueOrganizacaoSemanaViewProps) {
  const query = useEstoqueOrganizacaoSemana(sessionToken);
  const { pendingId, errorMessage, atualizarProgresso, concluirEstante } =
    useEstoqueOrganizacaoProgresso();
  const atribuicoes = query.data ?? [];
  const semanaLabel = formatSemanaLabel(weekStartISO(getManausDateISO()));

  return (
    <div className="flex flex-col gap-4">
      <span className="text-center text-sm font-semibold text-foreground">
        {ESTOQUE_ORGANIZACAO_SEMANA_HEADER_PREFIX} {semanaLabel}
      </span>

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {ESTOQUE_ORGANIZACAO_CARREGANDO_MESSAGE}
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{ESTOQUE_ORGANIZACAO_ERRO_MESSAGE}</p>
      ) : atribuicoes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {ESTOQUE_ORGANIZACAO_SEMANA_VAZIA_MESSAGE}
        </p>
      ) : (
        <Card className="divide-y divide-border">
          {atribuicoes.map((atribuicao) => (
            <EstoqueOrganizacaoLinha
              key={atribuicao.id}
              atribuicao={atribuicao}
              podeEditar={atribuicao.funcionario_id === funcionarioLogadoId}
              pendingId={pendingId}
              onAtualizarProgresso={(id, n) => void atualizarProgresso(sessionToken, id, n)}
              onConcluir={(id) => void concluirEstante(sessionToken, id)}
            />
          ))}
        </Card>
      )}

      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

      <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
        <h2 className="text-sm font-semibold text-foreground">
          {ESTOQUE_ORGANIZACAO_DIRETRIZES_TITLE}
        </h2>
        <ul className="flex flex-col gap-2">
          {ESTOQUE_ORGANIZACAO_DIRETRIZES.map((diretriz) => (
            <li key={diretriz.titulo} className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{diretriz.titulo}:</span>{" "}
              {diretriz.texto}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface EstoqueOrganizacaoLinhaProps {
  atribuicao: EstoqueOrganizacaoAtribuicaoSemana;
  podeEditar: boolean;
  pendingId: string | null;
  onAtualizarProgresso: (id: string, prateleirasConcluidas: number) => void;
  onConcluir: (id: string) => void;
}

function EstoqueOrganizacaoLinha({
  atribuicao,
  podeEditar,
  pendingId,
  onAtualizarProgresso,
  onConcluir,
}: EstoqueOrganizacaoLinhaProps) {
  const concluida = atribuicao.prateleiras_concluidas === 5;
  const salvando = pendingId === atribuicao.id;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{atribuicao.funcionario_apelido}</span>
          <span className="text-xs text-muted-foreground">
            {getEstoqueOrganizacaoEstanteLabel(atribuicao.numero_estante)}
          </span>
        </div>
        {concluida ? (
          <Badge variant="outline" className="flex w-fit shrink-0 items-center gap-1 text-xs">
            <Check className="h-3 w-3 text-brand" aria-hidden />
            {atribuicao.concluido_por_apelido && atribuicao.concluido_em
              ? atribuicao.concluido_por_apelido === atribuicao.funcionario_apelido
                ? getEstoqueOrganizacaoConcluidoLabel(formatLimpezaHora(atribuicao.concluido_em))
                : getEstoqueOrganizacaoConcluidoPorLabel(
                    atribuicao.concluido_por_apelido,
                    formatLimpezaHora(atribuicao.concluido_em),
                  )
              : getEstoqueOrganizacaoPrateleirasLabel(atribuicao.prateleiras_concluidas)}
          </Badge>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            {getEstoqueOrganizacaoPrateleirasLabel(atribuicao.prateleiras_concluidas)}
          </span>
        )}
      </div>

      {podeEditar && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1" role="group" aria-label={getEstoqueOrganizacaoPrateleirasLabel(atribuicao.prateleiras_concluidas)}>
            {[1, 2, 3, 4, 5].map((n) => {
              const preenchida = n <= atribuicao.prateleiras_concluidas;
              return (
                <Button
                  key={n}
                  type="button"
                  variant={preenchida ? "default" : "outline"}
                  size="icon"
                  className="min-touch h-9 w-9"
                  disabled={salvando}
                  aria-pressed={preenchida}
                  aria-label={`${n}/5`}
                  onClick={() => onAtualizarProgresso(atribuicao.id, n === atribuicao.prateleiras_concluidas ? n - 1 : n)}
                >
                  {n}
                </Button>
              );
            })}
          </div>

          {!concluida && (
            <Button
              type="button"
              size="sm"
              className="min-touch shrink-0"
              disabled={salvando}
              onClick={() => onConcluir(atribuicao.id)}
            >
              {salvando ? ESTOQUE_ORGANIZACAO_CONCLUINDO_LABEL : ESTOQUE_ORGANIZACAO_CONCLUIR_ESTANTE_LABEL}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
