import { Loader2 } from "lucide-react";

import { EscalaGrupoDia } from "@/components/escala/EscalaGrupoDia";
import { Card } from "@/components/ui/card";
import {
  ESCALA_CARREGANDO_MESSAGE,
  ESCALA_ERRO_MESSAGE,
  ESCALA_NAO_PUBLICADA_MESSAGE,
} from "@/config/constants";
import { useEscalaMesesPublicados } from "@/hooks/useEscalaMesesPublicados";
import { useEscalaPeriodo } from "@/hooks/useEscalaPeriodo";
import { addDaysISO, formatEscalaDiaHeader, getManausDateISO, monthStartISO } from "@/lib/escala";
import { cn } from "@/lib/utils";

interface EscalaSemanaViewProps {
  sessionToken: string | null;
  funcionarioLogadoId: string | null;
  /** Reference date the 7-day window starts from (carries over from Hoje's selected date). */
  dataInicio: string;
}

export function EscalaSemanaView({
  sessionToken,
  funcionarioLogadoId,
  dataInicio,
}: EscalaSemanaViewProps) {
  const dataFim = addDaysISO(dataInicio, 6);
  const query = useEscalaPeriodo(sessionToken, dataInicio, dataFim);
  const mesesPublicadosQuery = useEscalaMesesPublicados(sessionToken);
  const hojeISO = getManausDateISO();

  if (query.isLoading || mesesPublicadosQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {ESCALA_CARREGANDO_MESSAGE}
      </div>
    );
  }

  if (query.isError) {
    return <p className="py-8 text-center text-sm text-destructive">{ESCALA_ERRO_MESSAGE}</p>;
  }

  const entradas = query.data ?? [];
  const dias = Array.from({ length: 7 }, (_, i) => addDaysISO(dataInicio, i));
  // Same distinction as Hoje, applied per day since a 7-day window can span
  // two calendar months — each card checks its own month's publication
  // rather than assuming the whole week shares one answer.
  const mesesPublicados = new Set((mesesPublicadosQuery.data ?? []).map((m) => m.mes_referencia));

  return (
    <div className="flex flex-col gap-3">
      {dias.map((dia) => {
        const entradasDoDia = entradas.filter((entrada) => entrada.data === dia);
        const feriado = entradasDoDia.find((entrada) => entrada.feriado_nome !== null);
        const mesPublicado = mesesPublicados.has(monthStartISO(dia));
        return (
          <Card
            key={dia}
            className={cn(
              "flex flex-col gap-3 p-4 shadow-card",
              dia === hojeISO && "border-primary/50",
            )}
          >
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {formatEscalaDiaHeader(dia)}
              </span>
              {feriado && <span className="text-xs text-brand">{feriado.feriado_nome}</span>}
            </div>
            {mesPublicado ? (
              <EscalaGrupoDia
                entradas={entradasDoDia}
                funcionarioLogadoId={funcionarioLogadoId}
                compact
              />
            ) : (
              <p className="text-sm text-muted-foreground">{ESCALA_NAO_PUBLICADA_MESSAGE}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
