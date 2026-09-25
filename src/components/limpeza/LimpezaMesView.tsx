import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  LIMPEZA_CARREGANDO_MESSAGE,
  LIMPEZA_ERRO_MESSAGE,
  LIMPEZA_MES_ANTERIOR_LABEL,
  LIMPEZA_MES_CONCLUIDOS_COLUNA_LABEL,
  LIMPEZA_MES_PASSAR_PANO_COLUNA_LABEL,
  LIMPEZA_MES_PENDENTES_COLUNA_LABEL,
  LIMPEZA_MES_TOTAL_COLUNA_LABEL,
  LIMPEZA_MES_VARRER_COLUNA_LABEL,
  LIMPEZA_MES_VAZIO_MESSAGE,
  LIMPEZA_PROXIMO_MES_LABEL,
} from "@/config/constants";
import { addMonthsISO, formatMesAno } from "@/lib/escala";
import { useLimpezaMes } from "@/hooks/useLimpezaMes";

interface LimpezaMesViewProps {
  sessionToken: string | null;
  mesSelecionado: string;
  onMesSelecionadoChange: (mes: string) => void;
}

export function LimpezaMesView({
  sessionToken,
  mesSelecionado,
  onMesSelecionadoChange,
}: LimpezaMesViewProps) {
  const query = useLimpezaMes(sessionToken, mesSelecionado);
  const resumo = query.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={LIMPEZA_MES_ANTERIOR_LABEL}
          onClick={() => onMesSelecionadoChange(addMonthsISO(mesSelecionado, -1))}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className="flex-1 text-center text-sm font-semibold text-foreground">
          {formatMesAno(mesSelecionado)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={LIMPEZA_PROXIMO_MES_LABEL}
          onClick={() => onMesSelecionadoChange(addMonthsISO(mesSelecionado, 1))}
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {LIMPEZA_CARREGANDO_MESSAGE}
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{LIMPEZA_ERRO_MESSAGE}</p>
      ) : resumo.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {LIMPEZA_MES_VAZIO_MESSAGE}
        </p>
      ) : (
        <Card className="divide-y divide-border">
          {resumo.map((item) => (
            <div key={item.funcionario_id} className="flex flex-col gap-2 p-3">
              <span className="text-sm font-semibold text-foreground">
                {item.funcionario_apelido}
              </span>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-5">
                <div className="flex justify-between gap-1 sm:flex-col sm:justify-start">
                  <dt>{LIMPEZA_MES_VARRER_COLUNA_LABEL}</dt>
                  <dd className="font-medium text-foreground">{item.varrer_atribuidos}</dd>
                </div>
                <div className="flex justify-between gap-1 sm:flex-col sm:justify-start">
                  <dt>{LIMPEZA_MES_PASSAR_PANO_COLUNA_LABEL}</dt>
                  <dd className="font-medium text-foreground">{item.passar_pano_atribuidos}</dd>
                </div>
                <div className="flex justify-between gap-1 sm:flex-col sm:justify-start">
                  <dt>{LIMPEZA_MES_TOTAL_COLUNA_LABEL}</dt>
                  <dd className="font-medium text-foreground">{item.total}</dd>
                </div>
                <div className="flex justify-between gap-1 sm:flex-col sm:justify-start">
                  <dt>{LIMPEZA_MES_CONCLUIDOS_COLUNA_LABEL}</dt>
                  <dd className="font-medium text-foreground">{item.concluidos}</dd>
                </div>
                <div className="flex justify-between gap-1 sm:flex-col sm:justify-start">
                  <dt>{LIMPEZA_MES_PENDENTES_COLUNA_LABEL}</dt>
                  <dd className="font-medium text-foreground">{item.pendentes}</dd>
                </div>
              </dl>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
