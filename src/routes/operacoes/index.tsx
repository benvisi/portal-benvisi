import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Boxes, CalendarDays, Link2, MessageCircle, Sparkles } from "lucide-react";

import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  CONTAGEM_EMBALAGENS_CARD_DESCRIPTION,
  CONTAGEM_EMBALAGENS_TITLE,
  ESCALA_CARD_DESCRIPTION,
  ESCALA_TITLE,
  LIMPEZA_CARD_DESCRIPTION,
  LIMPEZA_TITLE,
  LINKS_IMPORTANTES_CARD_DESCRIPTION,
  LINKS_IMPORTANTES_TITLE,
  MENSAGENS_WHATSAPP_CARD_DESCRIPTION,
  MENSAGENS_WHATSAPP_TITLE,
  OPERACOES_PAGE_SUBTITLE,
  OPERACOES_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/operacoes/")({
  head: () => ({
    meta: [{ title: "Operações — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: OperacoesPage,
});

// Milestone 4A/4B/4C.1/4D: content hub for Operações. Only currently-
// implemented resources are shown as active cards — the rest of the
// Operações roadmap (Blueprint section 10) remains future scope and is
// deliberately not rendered here as disabled placeholders. Navigation is
// not being redesigned in this milestone; only the order of the real
// module cards is curated (Blueprint section 18).
//
// variant="brand-level-2": this hub is one level below the Dashboard, so
// its tiles use the softer navigation-depth tier (Blueprint section 14.8)
// rather than the Dashboard's own full-saturation brand green.
function OperacoesPage() {
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
          <h1 className="text-xl font-semibold text-foreground">{OPERACOES_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{OPERACOES_PAGE_SUBTITLE}</p>

        {/*
          Card order approved by the product owner (Milestone 4D QA polish):
          Escala, Mensagens para WhatsApp, Contagem de Embalagens, Links
          Importantes. Not a hub redesign — just the ordering of the real
          modules (Blueprint section 18).
        */}
        <div className="flex flex-col gap-4">
          <ModuleCard
            icon={CalendarDays}
            title={ESCALA_TITLE}
            description={ESCALA_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_ESCALA })}
          />
          <ModuleCard
            icon={MessageCircle}
            title={MENSAGENS_WHATSAPP_TITLE}
            description={MENSAGENS_WHATSAPP_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_MENSAGENS_WHATSAPP })}
          />
          <ModuleCard
            icon={Boxes}
            title={CONTAGEM_EMBALAGENS_TITLE}
            description={CONTAGEM_EMBALAGENS_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_CONTAGEM_EMBALAGENS })}
          />
          <ModuleCard
            icon={Link2}
            title={LINKS_IMPORTANTES_TITLE}
            description={LINKS_IMPORTANTES_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_LINKS_IMPORTANTES })}
          />
          <ModuleCard
            icon={Sparkles}
            title={LIMPEZA_TITLE}
            description={LIMPEZA_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_LIMPEZA })}
          />
        </div>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
