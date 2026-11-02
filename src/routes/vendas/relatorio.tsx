import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";

import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { VendasRelatorioTabela } from "@/components/vendas/VendasRelatorioTabela";
import { Button } from "@/components/ui/button";
import {
  RELATORIO_VENDAS_PAGE_SUBTITLE,
  RELATORIO_VENDAS_TITLE,
  VOLTAR_A_VENDAS_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useVendasMetricasMtd } from "@/hooks/useVendasMetricasMtd";
import { formatVendasAtualizadoEm } from "@/lib/vendasRelatorio";

export const Route = createFileRoute("/vendas/relatorio")({
  head: () => ({
    meta: [
      { title: "Relatório de vendas — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RelatorioVendasPage,
});

// Narrow side padding on phones so the first five columns fit the portrait
// viewport; the table itself is not capped to phone width.
function RelatorioVendasPage() {
  const goBack = useGoBack(ROUTES.VENDAS);
  const { session, ready } = useRequireSession();
  const query = useVendasMetricasMtd();

  if (!ready || !session) return null;

  const atualizadoEm = query.data?.[0]?.atualizado_em;

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
            aria-label={VOLTAR_A_VENDAS_LABEL}
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

        {query.isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
          </div>
        )}
        {query.isError && (
          <p className="px-2 text-sm text-destructive">
            Não foi possível carregar o relatório. Tente novamente.
          </p>
        )}
        {query.data && <VendasRelatorioTabela linhas={query.data} />}
      </div>

      <AuthUtilityBar />
    </main>
  );
}
