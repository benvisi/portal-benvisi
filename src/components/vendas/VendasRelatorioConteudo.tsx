import { Loader2 } from "lucide-react";

import { VendasRelatorioTabela } from "@/components/vendas/VendasRelatorioTabela";
import { Button } from "@/components/ui/button";
import {
  RELATORIO_VENDAS_ERRO_MESSAGE,
  RELATORIO_VENDAS_TENTAR_NOVAMENTE_LABEL,
  RELATORIO_VENDAS_VAZIO_MESSAGE,
} from "@/config/constants";
import { isRelatorioVendasVazio, type VendasMetricasLinha } from "@/lib/vendasRelatorio";

interface VendasRelatorioConteudoProps {
  isLoading: boolean;
  isError: boolean;
  linhas: readonly VendasMetricasLinha[] | undefined;
  onRetry: () => void;
}

/** Loading / error / empty / table states for Relatório de vendas. */
export function VendasRelatorioConteudo({
  isLoading,
  isError,
  linhas,
  onRetry,
}: VendasRelatorioConteudoProps) {
  if (linhas) {
    if (isRelatorioVendasVazio(linhas)) {
      return <p className="px-2 text-sm text-muted-foreground">{RELATORIO_VENDAS_VAZIO_MESSAGE}</p>;
    }
    return <VendasRelatorioTabela linhas={linhas} />;
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
