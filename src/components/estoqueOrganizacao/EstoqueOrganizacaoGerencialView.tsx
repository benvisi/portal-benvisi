import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CalendarDays,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ESTOQUE_ORGANIZACAO_CARREGANDO_MESSAGE,
  ESTOQUE_ORGANIZACAO_GERENCIAL_ATRIBUIDAS_LABEL,
  ESTOQUE_ORGANIZACAO_GERENCIAL_CONCLUIDAS_LABEL,
  ESTOQUE_ORGANIZACAO_GERENCIAL_ERRO_MESSAGE,
  ESTOQUE_ORGANIZACAO_GERENCIAL_NAO_CONCLUIDAS_LABEL,
  ESTOQUE_ORGANIZACAO_GERENCIAL_PENDENTES_LABEL,
  ESTOQUE_ORGANIZACAO_GERENCIAL_TITLE,
  ESTOQUE_ORGANIZACAO_GERENCIAL_VAZIO_MESSAGE,
  ESTOQUE_ORGANIZACAO_PROXIMA_SEMANA_LABEL,
  ESTOQUE_ORGANIZACAO_SEMANA_ANTERIOR_LABEL,
  ESTOQUE_ORGANIZACAO_SEMANA_ATUAL_LABEL,
  ESTOQUE_ORGANIZACAO_SINCRONIZANDO_LABEL,
  ESTOQUE_ORGANIZACAO_SINCRONIZAR_LABEL,
  getEstoqueOrganizacaoEstanteLabel,
  getEstoqueOrganizacaoPrateleirasLabel,
  getEstoqueOrganizacaoSyncPendenciaMessage,
} from "@/config/constants";
import { addWeeksISO, formatSemanaLabel, weekStartISO } from "@/lib/estoqueOrganizacao";
import { getManausDateISO } from "@/lib/escala";
import { useEstoqueOrganizacaoGerencialSemana } from "@/hooks/useEstoqueOrganizacaoGerencialSemana";
import { useEstoqueOrganizacaoSincronizarManual } from "@/hooks/useEstoqueOrganizacaoSincronizarManual";
import { useEstoqueOrganizacaoSyncPendencias } from "@/hooks/useEstoqueOrganizacaoSyncPendencias";

interface EstoqueOrganizacaoGerencialViewProps {
  sessionToken: string | null;
  semanaSelecionada: string;
  onSemanaSelecionadaChange: (semanaInicio: string) => void;
  ativo: boolean;
}

export function EstoqueOrganizacaoGerencialView({
  sessionToken,
  semanaSelecionada,
  onSemanaSelecionadaChange,
  ativo,
}: EstoqueOrganizacaoGerencialViewProps) {
  const semanaAtual = weekStartISO(getManausDateISO());
  const query = useEstoqueOrganizacaoGerencialSemana(sessionToken, semanaSelecionada, ativo);
  const {
    syncing,
    errorMessage: syncErrorMessage,
    sincronizar,
  } = useEstoqueOrganizacaoSincronizarManual(sessionToken);
  const pendenciasQuery = useEstoqueOrganizacaoSyncPendencias(sessionToken, ativo);
  const pendencias = pendenciasQuery.data ?? [];
  const atribuicoes = query.data ?? [];

  const ehSemanaAtual = semanaSelecionada === semanaAtual;
  const totalAtribuidas = atribuicoes.length;
  const totalConcluidas = atribuicoes.filter((a) => a.prateleiras_concluidas === 5).length;
  const totalAbertas = totalAtribuidas - totalConcluidas;

  return (
    <div className="flex flex-col gap-6">
      {pendencias.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          {pendencias.map((pendencia) => (
            <div
              key={pendencia.semana_inicio}
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {getEstoqueOrganizacaoSyncPendenciaMessage(
                  formatSemanaLabel(pendencia.semana_inicio),
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={ESTOQUE_ORGANIZACAO_SEMANA_ANTERIOR_LABEL}
          onClick={() => onSemanaSelecionadaChange(addWeeksISO(semanaSelecionada, -1))}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className="flex-1 text-center text-sm font-semibold text-foreground">
          {formatSemanaLabel(semanaSelecionada)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={ESTOQUE_ORGANIZACAO_PROXIMA_SEMANA_LABEL}
          onClick={() => onSemanaSelecionadaChange(addWeeksISO(semanaSelecionada, 1))}
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {!ehSemanaAtual && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-touch w-fit gap-2 self-center"
          onClick={() => onSemanaSelecionadaChange(semanaAtual)}
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          {ESTOQUE_ORGANIZACAO_SEMANA_ATUAL_LABEL}
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-touch w-fit gap-2 self-end"
        disabled={syncing}
        onClick={() => void sincronizar(semanaSelecionada)}
      >
        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden />
        {syncing ? ESTOQUE_ORGANIZACAO_SINCRONIZANDO_LABEL : ESTOQUE_ORGANIZACAO_SINCRONIZAR_LABEL}
      </Button>
      {syncErrorMessage && <p className="text-xs text-destructive">{syncErrorMessage}</p>}

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {ESTOQUE_ORGANIZACAO_CARREGANDO_MESSAGE}
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">
          {ESTOQUE_ORGANIZACAO_GERENCIAL_ERRO_MESSAGE}
        </p>
      ) : atribuicoes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {ESTOQUE_ORGANIZACAO_GERENCIAL_VAZIO_MESSAGE}
        </p>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-foreground">
            {ESTOQUE_ORGANIZACAO_GERENCIAL_TITLE}
          </h2>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="flex flex-col rounded-md border border-border p-2">
              <span className="text-lg font-semibold text-foreground">{totalAtribuidas}</span>
              <span className="text-xs text-muted-foreground">
                {ESTOQUE_ORGANIZACAO_GERENCIAL_ATRIBUIDAS_LABEL}
              </span>
            </div>
            <div className="flex flex-col rounded-md border border-border p-2">
              <span className="text-lg font-semibold text-foreground">{totalConcluidas}</span>
              <span className="text-xs text-muted-foreground">
                {ESTOQUE_ORGANIZACAO_GERENCIAL_CONCLUIDAS_LABEL}
              </span>
            </div>
            <div className="flex flex-col rounded-md border border-border p-2">
              <span className="text-lg font-semibold text-foreground">{totalAbertas}</span>
              <span className="text-xs text-muted-foreground">
                {ehSemanaAtual
                  ? ESTOQUE_ORGANIZACAO_GERENCIAL_PENDENTES_LABEL
                  : ESTOQUE_ORGANIZACAO_GERENCIAL_NAO_CONCLUIDAS_LABEL}
              </span>
            </div>
          </div>

          <Card className="divide-y divide-border">
            {atribuicoes.map((atribuicao) => (
              <div key={atribuicao.id} className="flex items-center justify-between gap-2 p-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {atribuicao.funcionario_apelido}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {getEstoqueOrganizacaoEstanteLabel(atribuicao.numero_estante)}
                  </span>
                </div>
                {atribuicao.prateleiras_concluidas === 5 ? (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {ESTOQUE_ORGANIZACAO_GERENCIAL_CONCLUIDAS_LABEL}
                  </Badge>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {getEstoqueOrganizacaoPrateleirasLabel(atribuicao.prateleiras_concluidas)}
                  </span>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
