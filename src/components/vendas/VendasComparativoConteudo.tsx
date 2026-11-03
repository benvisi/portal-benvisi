import { Loader2 } from "lucide-react";

import { VendasComparativoTabela } from "@/components/vendas/VendasComparativoTabela";
import { Button } from "@/components/ui/button";
import {
  RELATORIO_VENDAS_ERRO_MESSAGE,
  RELATORIO_VENDAS_TENTAR_NOVAMENTE_LABEL,
  RELATORIO_VENDAS_VAZIO_MESSAGE,
} from "@/config/constants";
import { isComparativoVazio, type VendasComparativoJanela } from "@/lib/vendasComparativo";
import type { VendasPeriodo } from "@/lib/vendasRelatorio";

interface VendasComparativoConteudoProps {
  periodo: VendasPeriodo;
  isLoading: boolean;
  isError: boolean;
  janelas: readonly VendasComparativoJanela[] | undefined;
  onRetry: () => void;
}

/** Loading / error / empty / table states for the Comparativo view. */
export function VendasComparativoConteudo({
  periodo,
  isLoading,
  isError,
  janelas,
  onRetry,
}: VendasComparativoConteudoProps) {
  if (janelas) {
    if (janelas.length === 0 || isComparativoVazio(janelas)) {
      return <p className="px-2 text-sm text-muted-foreground">{RELATORIO_VENDAS_VAZIO_MESSAGE}</p>;
    }
    return <VendasComparativoTabela periodo={periodo} janelas={janelas} />;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3 px-2">
        <p className="text-sm text-destructive">{RELATORIO_VENDAS_ERRO_MESSAGE}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          {RELATORIO_VENDAS_TENTAR_NOVAMENTE_LABEL}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" />
      </div>
    );
  }

  return null;
}
