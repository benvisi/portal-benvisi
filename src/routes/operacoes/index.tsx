import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Link2, MessageCircle } from "lucide-react";

import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { Button } from "@/components/ui/button";
import {
  LINKS_IMPORTANTES_CARD_DESCRIPTION,
  LINKS_IMPORTANTES_TITLE,
  MENSAGENS_WHATSAPP_CARD_DESCRIPTION,
  MENSAGENS_WHATSAPP_TITLE,
  OPERACOES_PAGE_SUBTITLE,
  OPERACOES_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/operacoes/")({
  head: () => ({
    meta: [{ title: "Operações — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: OperacoesPage,
});

// Milestone 4A/4B: content hub for Operações. Only currently-implemented
// resources are shown as active cards — the rest of the Operações roadmap
// (Blueprint section 10) remains future scope and is deliberately not
// rendered here as disabled placeholders.
function OperacoesPage() {
  const navigate = useNavigate();
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
            onClick={() => void navigate({ to: ROUTES.DASHBOARD })}
            aria-label={VOLTAR_AO_PAINEL_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{OPERACOES_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{OPERACOES_PAGE_SUBTITLE}</p>

        <div className="flex flex-col gap-4">
          <ModuleCard
            icon={Link2}
            title={LINKS_IMPORTANTES_TITLE}
            description={LINKS_IMPORTANTES_CARD_DESCRIPTION}
            variant="brand"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_LINKS_IMPORTANTES })}
          />
          <ModuleCard
            icon={MessageCircle}
            title={MENSAGENS_WHATSAPP_TITLE}
            description={MENSAGENS_WHATSAPP_CARD_DESCRIPTION}
            variant="brand"
            onClick={() => void navigate({ to: ROUTES.OPERACOES_MENSAGENS_WHATSAPP })}
          />
        </div>
      </div>
    </main>
  );
}
