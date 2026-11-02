import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, MessageCircle, Package } from "lucide-react";

import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  CONSULTA_ESTOQUE_CARD_DESCRIPTION,
  CONSULTA_ESTOQUE_TITLE,
  MENSAGENS_WHATSAPP_CARD_DESCRIPTION,
  MENSAGENS_WHATSAPP_TITLE,
  RELATORIO_VENDAS_CARD_DESCRIPTION,
  RELATORIO_VENDAS_TITLE,
  VENDAS_PAGE_SUBTITLE,
  VENDAS_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/vendas/")({
  head: () => ({
    meta: [{ title: "Vendas — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: VendasPage,
});

// Content hub for Vendas. Tiles use "brand-level-2" like the other hubs
// (one level below the Dashboard).
function VendasPage() {
  const navigate = useNavigate();
  const goBack = useGoBack(ROUTES.DASHBOARD);
  const { session, ready } = useRequireSession();

  if (!ready || !session) return null;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={goBack}
            aria-label={VOLTAR_AO_PAINEL_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{VENDAS_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{VENDAS_PAGE_SUBTITLE}</p>

        <div className="flex flex-col gap-4">
          <ModuleCard
            icon={Package}
            title={CONSULTA_ESTOQUE_TITLE}
            description={CONSULTA_ESTOQUE_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.ESTOQUE })}
          />
          <ModuleCard
            icon={BarChart3}
            title={RELATORIO_VENDAS_TITLE}
            description={RELATORIO_VENDAS_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.VENDAS_RELATORIO })}
          />
          <ModuleCard
            icon={MessageCircle}
            title={MENSAGENS_WHATSAPP_TITLE}
            description={MENSAGENS_WHATSAPP_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_MENSAGENS_WHATSAPP })}
          />
        </div>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
