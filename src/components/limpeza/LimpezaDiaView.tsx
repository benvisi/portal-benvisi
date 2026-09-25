import { ArrowLeft, ArrowRight, CalendarDays, Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  LIMPEZA_CARREGANDO_MESSAGE,
  LIMPEZA_CONCLUINDO_LABEL,
  LIMPEZA_CONCLUIR_LABEL,
  LIMPEZA_CONFLITO_LABEL,
  LIMPEZA_DIA_ANTERIOR_LABEL,
  LIMPEZA_DIA_VAZIO_MESSAGE,
  LIMPEZA_ERRO_MESSAGE,
  LIMPEZA_HOJE_LABEL,
  LIMPEZA_MANUAL_LABEL,
  LIMPEZA_PROXIMO_DIA_LABEL,
  LIMPEZA_SEM_CANDIDATO_LABEL,
  LIMPEZA_TAREFA_LABELS,
  LIMPEZA_TURNO_LABELS,
  getLimpezaConcluidoLabel,
  getLimpezaConcluidoPorLabel,
} from "@/config/constants";
import { addDaysISO, formatEscalaDiaHeader, getManausDateISO, monthStartISO } from "@/lib/escala";
import { formatLimpezaHora, LIMPEZA_TAREFA_ORDEM, LIMPEZA_TURNO_ORDEM } from "@/lib/limpeza";
import { useLimpezaConcluir } from "@/hooks/useLimpezaConcluir";
import { useLimpezaDia } from "@/hooks/useLimpezaDia";
import type { LimpezaTurno } from "@/integrations/supabase/contracts";

interface LimpezaDiaViewProps {
  sessionToken: string | null;
  funcionarioLogadoId: string | null;
  isManagerOrAdmin: boolean;
  dataSelecionada: string;
  onDataSelecionadaChange: (data: string) => void;
}

export function LimpezaDiaView({
  sessionToken,
  funcionarioLogadoId,
  isManagerOrAdmin,
  dataSelecionada,
  onDataSelecionadaChange,
}: LimpezaDiaViewProps) {
  const hojeISO = getManausDateISO();
  const query = useLimpezaDia(sessionToken, dataSelecionada);
  const { pendingId, errorMessage, concluir } = useLimpezaConcluir(
    sessionToken,
    dataSelecionada,
    monthStartISO(dataSelecionada),
  );
  const atribuicoes = query.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={LIMPEZA_DIA_ANTERIOR_LABEL}
          onClick={() => onDataSelecionadaChange(addDaysISO(dataSelecionada, -1))}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className="flex-1 text-center text-sm font-semibold text-foreground">
          {formatEscalaDiaHeader(dataSelecionada)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={LIMPEZA_PROXIMO_DIA_LABEL}
          onClick={() => onDataSelecionadaChange(addDaysISO(dataSelecionada, 1))}
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {dataSelecionada !== hojeISO && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-touch w-fit gap-2 self-center"
          onClick={() => onDataSelecionadaChange(hojeISO)}
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          {LIMPEZA_HOJE_LABEL}
        </Button>
      )}

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {LIMPEZA_CARREGANDO_MESSAGE}
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{LIMPEZA_ERRO_MESSAGE}</p>
      ) : atribuicoes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {LIMPEZA_DIA_VAZIO_MESSAGE}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {LIMPEZA_TURNO_ORDEM.map((turno) => {
            const doTurno = atribuicoes.filter((a) => a.turno === turno);
            if (doTurno.length === 0) return null;
            return (
              <LimpezaTurnoGrupo
                key={turno}
                turno={turno}
                atribuicoes={doTurno}
                funcionarioLogadoId={funcionarioLogadoId}
                isManagerOrAdmin={isManagerOrAdmin}
                pendingId={pendingId}
                onConcluir={concluir}
              />
            );
          })}
        </div>
      )}

      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
    </div>
  );
}

interface LimpezaTurnoGrupoProps {
  turno: LimpezaTurno;
  atribuicoes: ReturnType<typeof useLimpezaDia>["data"];
  funcionarioLogadoId: string | null;
  isManagerOrAdmin: boolean;
  pendingId: string | null;
  onConcluir: (id: string) => void;
}

function LimpezaTurnoGrupo({
  turno,
  atribuicoes,
  funcionarioLogadoId,
  isManagerOrAdmin,
  pendingId,
  onConcluir,
}: LimpezaTurnoGrupoProps) {
  const rows = LIMPEZA_TAREFA_ORDEM.map((tarefa) =>
    (atribuicoes ?? []).find((a) => a.tarefa === tarefa),
  ).filter((a): a is NonNullable<typeof a> => a !== undefined);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">{LIMPEZA_TURNO_LABELS[turno]}</h2>
      <Card className="divide-y divide-border">
        {rows.map((atribuicao) => {
          const podeConcluir =
            atribuicao.status === "pendente" &&
            atribuicao.funcionario_id !== null &&
            (atribuicao.funcionario_id === funcionarioLogadoId || isManagerOrAdmin);

          return (
            <div key={atribuicao.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {LIMPEZA_TAREFA_LABELS[atribuicao.tarefa]}
                  {atribuicao.funcionario_apelido && ` — ${atribuicao.funcionario_apelido}`}
                </span>
                {atribuicao.status === "concluida" && atribuicao.concluido_em && (
                  <span className="text-xs text-muted-foreground">
                    {atribuicao.concluido_por_apelido &&
                    atribuicao.concluido_por_apelido !== atribuicao.funcionario_apelido
                      ? getLimpezaConcluidoPorLabel(
                          atribuicao.concluido_por_apelido,
                          formatLimpezaHora(atribuicao.concluido_em),
                        )
                      : getLimpezaConcluidoLabel(formatLimpezaHora(atribuicao.concluido_em))}
                  </span>
                )}
                {atribuicao.status === "sem_candidato" && (
                  <Badge variant="outline" className="w-fit text-xs">
                    {LIMPEZA_SEM_CANDIDATO_LABEL}
                  </Badge>
                )}
                {atribuicao.status === "conflito" && (
                  <Badge variant="destructive" className="w-fit text-xs">
                    {LIMPEZA_CONFLITO_LABEL}
                  </Badge>
                )}
                {atribuicao.bloqueada && atribuicao.status === "pendente" && (
                  <Badge variant="outline" className="w-fit text-xs">
                    {LIMPEZA_MANUAL_LABEL}
                  </Badge>
                )}
              </div>

              {atribuicao.status === "concluida" ? (
                <Check className="h-5 w-5 shrink-0 text-brand" aria-hidden />
              ) : (
                podeConcluir && (
                  <Button
                    type="button"
                    size="sm"
                    className="min-touch shrink-0"
                    disabled={pendingId === atribuicao.id}
                    onClick={() => onConcluir(atribuicao.id)}
                  >
                    {pendingId === atribuicao.id
                      ? LIMPEZA_CONCLUINDO_LABEL
                      : LIMPEZA_CONCLUIR_LABEL}
                  </Button>
                )
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
