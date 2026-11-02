import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { VendasRelatorioConteudo } from "@/components/vendas/VendasRelatorioConteudo";
import { Button } from "@/components/ui/button";
import {
  RELATORIO_VENDAS_PAGE_SUBTITLE,
  RELATORIO_VENDAS_TITLE,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useVendasMetricasMtd } from "@/hooks/useVendasMetricasMtd";
import {
  canViewRelatorioVendas,
  formatVendasAtualizadoEm,
  getVendasAtualizadoEm,
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
  const allowed = canViewRelatorioVendas(session?.cargo);
  // Never call the RPC for an unauthorized cargo (it would reject it anyway).
  const query = useVendasMetricasMtd(
    allowed ? (session?.funcionario_id ?? null) : null,
    allowed ? (session?.session_token ?? null) : null,
  );

  useEffect(() => {
    if (ready && session && !allowed) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [ready, session, allowed, navigate]);

  if (!ready || !session || !allowed) return null;

  const atualizadoEm = query.data ? getVendasAtualizadoEm(query.data) : null;

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

        <div className="flex flex-col gap-1 px-2.5">
          <p className="text-sm text-muted-foreground">{RELATORIO_VENDAS_PAGE_SUBTITLE}</p>
          {atualizadoEm && (
            <p className="text-xs text-muted-foreground">
              {formatVendasAtualizadoEm(atualizadoEm)}
            </p>
          )}
        </div>

        <VendasRelatorioConteudo
          isLoading={query.isLoading}
          isError={query.isError}
          linhas={query.data}
          onRetry={() => void query.refetch()}
        />
      </div>

      <AuthUtilityBar />
    </main>
  );
}
