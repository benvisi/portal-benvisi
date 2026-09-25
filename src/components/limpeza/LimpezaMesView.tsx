import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LimpezaTarefaChip } from "@/components/limpeza/LimpezaTarefaChip";
import {
  LIMPEZA_CARREGANDO_MESSAGE,
  LIMPEZA_ERRO_MESSAGE,
  LIMPEZA_MES_ANTERIOR_LABEL,
  LIMPEZA_MES_CONCLUIDOS_COLUNA_LABEL,
  LIMPEZA_MES_DISTRIBUICAO_TITLE,
  LIMPEZA_MES_EXECUCAO_TITLE,
  LIMPEZA_MES_NAO_CONCLUIDOS_COLUNA_LABEL,
  LIMPEZA_MES_NAO_CONCLUIDOS_HINT,
  LIMPEZA_MES_TOTAL_COLUNA_LABEL,
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
        <>
          <Card className="divide-y divide-border">
            {resumo.map((item) => (
              <div key={item.funcionario_id} className="flex flex-col gap-3 p-3">
                <span className="text-sm font-semibold text-foreground">
                  {item.funcionario_apelido}
                </span>

                {/*
                  Two columns at every width (not just mobile) — Distribuição
                  (workload) vs Execução (completion), kept separate so
                  neither list of numbers gets confused for the other. No
                  horizontal scroll at any width.
                */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {LIMPEZA_MES_DISTRIBUICAO_TITLE}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <LimpezaTarefaChip tarefa="varrer" />
                      <span className="text-sm font-medium text-foreground">
                        {item.varrer_atribuidos}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <LimpezaTarefaChip tarefa="passar_pano" />
                      <span className="text-sm font-medium text-foreground">
                        {item.passar_pano_atribuidos}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5">
                      <span className="text-sm font-bold text-foreground">
                        {LIMPEZA_MES_TOTAL_COLUNA_LABEL}
                      </span>
                      <span className="text-sm font-bold text-foreground">{item.total}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {LIMPEZA_MES_EXECUCAO_TITLE}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {LIMPEZA_MES_CONCLUIDOS_COLUNA_LABEL}
                      </span>
                      <span className="text-sm font-medium text-foreground">{item.concluidos}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {LIMPEZA_MES_NAO_CONCLUIDOS_COLUNA_LABEL}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {item.nao_concluidos}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Card>
          <p className="text-xs text-muted-foreground">{LIMPEZA_MES_NAO_CONCLUIDOS_HINT}</p>
        </>
      )}
    </div>
  );
}
