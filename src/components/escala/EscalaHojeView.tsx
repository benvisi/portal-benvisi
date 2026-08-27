import { ArrowLeft, ArrowRight, CalendarDays, Loader2 } from "lucide-react";

import { EscalaGrupoDia } from "@/components/escala/EscalaGrupoDia";
import { Button } from "@/components/ui/button";
import {
  ESCALA_CARREGANDO_MESSAGE,
  ESCALA_DIA_ANTERIOR_LABEL,
  ESCALA_ERRO_MESSAGE,
  ESCALA_HOJE_LABEL,
  ESCALA_NAO_PUBLICADA_MESSAGE,
  ESCALA_PROXIMO_DIA_LABEL,
} from "@/config/constants";
import { useEscalaMesesPublicados } from "@/hooks/useEscalaMesesPublicados";
import { useEscalaPeriodo } from "@/hooks/useEscalaPeriodo";
import { addDaysISO, formatEscalaDiaHeader, getManausDateISO, monthStartISO } from "@/lib/escala";

interface EscalaHojeViewProps {
  sessionToken: string | null;
  funcionarioLogadoId: string | null;
  dataSelecionada: string;
  onDataSelecionadaChange: (data: string) => void;
}

export function EscalaHojeView({
  sessionToken,
  funcionarioLogadoId,
  dataSelecionada,
  onDataSelecionadaChange,
}: EscalaHojeViewProps) {
  const hojeISO = getManausDateISO();
  const query = useEscalaPeriodo(sessionToken, dataSelecionada, dataSelecionada);
  const mesesPublicadosQuery = useEscalaMesesPublicados(sessionToken);
  const entradas = query.data ?? [];
  const feriado = entradas.find((entrada) => entrada.feriado_nome !== null);

  // Milestone 4C.2 QA fix: an unpublished month is a normal, successful
  // response (get_escala_periodo returns every active employee as
  // "a_confirmar"), never a query error — so it must never show the
  // "Não foi possível carregar" technical-failure copy. Checked explicitly
  // via list_escala_meses_publicados (the same source Mês already uses)
  // rather than inferred from "every row happens to be a_confirmar", so a
  // publication with a few genuinely-missing entries still renders those
  // normally under A CONFIRMAR instead of being mistaken for "unpublished".
  const mesesPublicados = new Set((mesesPublicadosQuery.data ?? []).map((m) => m.mes_referencia));
  const mesPublicado = mesesPublicados.has(monthStartISO(dataSelecionada));
  const carregando = query.isLoading || mesesPublicadosQuery.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={ESCALA_DIA_ANTERIOR_LABEL}
          onClick={() => onDataSelecionadaChange(addDaysISO(dataSelecionada, -1))}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Button>
        <div className="flex flex-1 flex-col items-center text-center">
          <span className="text-sm font-semibold text-foreground">
            {formatEscalaDiaHeader(dataSelecionada)}
          </span>
          {feriado && <span className="text-xs text-brand">{feriado.feriado_nome}</span>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={ESCALA_PROXIMO_DIA_LABEL}
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
          {ESCALA_HOJE_LABEL}
        </Button>
      )}

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {ESCALA_CARREGANDO_MESSAGE}
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{ESCALA_ERRO_MESSAGE}</p>
      ) : !mesPublicado ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {ESCALA_NAO_PUBLICADA_MESSAGE}
        </p>
      ) : (
        <EscalaGrupoDia entradas={entradas} funcionarioLogadoId={funcionarioLogadoId} />
      )}
    </div>
  );
}
