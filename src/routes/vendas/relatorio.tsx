import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { VendasComparativoConteudo } from "@/components/vendas/VendasComparativoConteudo";
import { VendasIncluirHojeToggle } from "@/components/vendas/VendasIncluirHojeToggle";
import { VendasPeriodoSeletor } from "@/components/vendas/VendasPeriodoSeletor";
import { VendasRelatorioConteudo } from "@/components/vendas/VendasRelatorioConteudo";
import { VendasVisaoSeletor } from "@/components/vendas/VendasVisaoSeletor";
import { Button } from "@/components/ui/button";
import {
  RELATORIO_VENDAS_VISAO_PADRAO,
  RELATORIO_VENDAS_TITLE,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useVendasComparativo } from "@/hooks/useVendasComparativo";
import { useVendasMetricasPeriodo } from "@/hooks/useVendasMetricasPeriodo";
import { getComparativoAtualizadoEm, type VendasVisao } from "@/lib/vendasComparativo";
import {
  canViewRelatorioVendas,
  formatVendasAtualizadoEm,
  getVendasAtualizadoEm,
  VENDAS_PERIODO_PADRAO,
  type VendasPeriodo,
} from "@/lib/vendasRelatorio";

export const Route = createFileRoute("/vendas/relatorio")({
  head: () => ({
    meta: [
      { title: "Relatório de vendas — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RelatorioVendasPage,
});

// Narrow side padding on phones; the table itself is not capped to phone width.
function RelatorioVendasPage() {
  const navigate = useNavigate();
  const goBack = useGoBack(ROUTES.OPERACOES);
  const { session, ready } = useRequireSession();
  // Not persisted: every visit starts on the default period (Hoje).
  const [periodo, setPeriodo] = useState<VendasPeriodo>(VENDAS_PERIODO_PADRAO);
  // Equipe (salesperson table) is the default view; Comparativo is store-level only.
  const [visao, setVisao] = useState<VendasVisao>(RELATORIO_VENDAS_VISAO_PADRAO);
  const [incluirHoje, setIncluirHoje] = useState(true);
  const allowed = canViewRelatorioVendas(session?.cargo);
  // Never call an RPC for an unauthorized cargo (it would reject it anyway),
  // and only the visible view fetches.
  const funcionarioId = allowed ? (session?.funcionario_id ?? null) : null;
  const sessionToken = allowed ? (session?.session_token ?? null) : null;
  const query = useVendasMetricasPeriodo(
    visao === "equipe" ? funcionarioId : null,
    visao === "equipe" ? sessionToken : null,
    periodo,
  );
  const comparativo = useVendasComparativo(
    visao === "comparativo" ? funcionarioId : null,
    visao === "comparativo" ? sessionToken : null,
    periodo,
    incluirHoje,
  );

  useEffect(() => {
    if (ready && session && !allowed) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [ready, session, allowed, navigate]);

  if (!ready || !session || !allowed) return null;

  const atualizadoEm =
    visao === "equipe"
      ? query.data
        ? getVendasAtualizadoEm(query.data)
        : null
      : comparativo.data
        ? getComparativoAtualizadoEm(comparativo.data)
        : null;

  return (
    <main className="min-h-screen bg-background px-1.5 py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="flex items-center gap-3 px-2.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={goBack}
            aria-label={VOLTAR_A_OPERACOES_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{RELATORIO_VENDAS_TITLE}</h1>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-x-3 px-2.5">
          <VendasPeriodoSeletor value={periodo} onChange={setPeriodo} />
          {visao === "comparativo" && (
            <VendasIncluirHojeToggle value={incluirHoje} onChange={setIncluirHoje} />
          )}
        </div>

        <div className="flex flex-col">
          {visao === "equipe" ? (
            <VendasRelatorioConteudo
              isLoading={query.isLoading}
              isError={query.isError}
              linhas={query.data}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <VendasComparativoConteudo
              periodo={periodo}
              isLoading={comparativo.isLoading}
              isError={comparativo.isError}
              janelas={comparativo.data}
              onRetry={() => void comparativo.refetch()}
            />
          )}
          <VendasVisaoSeletor value={visao} onChange={setVisao} />
        </div>

        {atualizadoEm && (
          <p className="px-2.5 text-xs text-muted-foreground">
            {formatVendasAtualizadoEm(atualizadoEm)}
          </p>
        )}
      </div>

      <AuthUtilityBar />
    </main>
  );
}
