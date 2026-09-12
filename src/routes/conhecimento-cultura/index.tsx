import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Compass } from "lucide-react";

import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  CONHECIMENTO_CULTURA_PAGE_SUBTITLE,
  CONHECIMENTO_CULTURA_TITLE,
  NOSSOS_PRINCIPIOS_CARD_DESCRIPTION,
  NOSSOS_PRINCIPIOS_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/conhecimento-cultura/")({
  head: () => ({
    meta: [
      { title: "Conhecimento & Cultura — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConhecimentoCulturaPage,
});

// Milestone 3A: this is the content hub for the module, not a one-off link
// straight to Nossos Princípios — future categories (section — Conhecimento
// & Cultura, Blueprint) will be added here as their own cards. Only one
// category exists today, so a single card is shown rather than several
// disabled placeholders.
//
// variant="brand-level-2": this hub is one level below the Dashboard, so
// its tiles use the softer navigation-depth tier (Blueprint section 14.8)
// rather than the Dashboard's own full-saturation brand green.
function ConhecimentoCulturaPage() {
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
          <h1 className="text-xl font-semibold text-foreground">{CONHECIMENTO_CULTURA_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{CONHECIMENTO_CULTURA_PAGE_SUBTITLE}</p>

        <div className="flex flex-col gap-4">
          <ModuleCard
            icon={Compass}
            title={NOSSOS_PRINCIPIOS_TITLE}
            description={NOSSOS_PRINCIPIOS_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.CONHECIMENTO_CULTURA_PRINCIPIOS })}
          />
        </div>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
