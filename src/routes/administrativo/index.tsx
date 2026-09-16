import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowLeft, CalendarDays, ClipboardCheck, Tags } from "lucide-react";

import { ModuleCard } from "@/components/dashboard/ModuleCard";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import {
  ADMINISTRATIVO_ATENDIMENTO_CARD_DESCRIPTION,
  ADMINISTRATIVO_ATENDIMENTO_TITLE,
  ADMINISTRATIVO_PAGE_SUBTITLE,
  ADMINISTRATIVO_PAGE_TITLE,
  ADMINISTRATOR_CARGO,
  ESCALA_ADMIN_CARD_DESCRIPTION,
  ESCALA_ADMIN_TITLE,
  TERMOS_BUSCA_ADMIN_CARD_DESCRIPTION,
  TERMOS_BUSCA_ADMIN_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useTermosBuscaPermissao } from "@/hooks/useTermosBuscaPermissao";

export const Route = createFileRoute("/administrativo/")({
  head: () => ({
    meta: [{ title: "Administrativo — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: AdministrativoPage,
});

// V1.1 IA change: Administrativo is now a plain module hub (same shape as
// Operações) rather than mixing module cards with an inline settings panel.
// Política do Checklist moved to Administrativo → Atendimento, unchanged in
// behavior — see administrativo/atendimento.tsx.
function AdministrativoPage() {
  const navigate = useNavigate();
  const goBack = useGoBack(ROUTES.DASHBOARD);
  const { session, ready } = useRequireSession();
  const isAdmin = session?.cargo === ADMINISTRATOR_CARGO;
  // Termos de busca is capability-gated (not cargo), so its card only shows
  // to an Administrador who also holds pode_gerenciar_termos_busca.
  const permissaoTermos = useTermosBuscaPermissao(session?.session_token ?? null);

  useEffect(() => {
    if (ready && session && !isAdmin) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [ready, session, isAdmin, navigate]);

  if (!ready || !session || !isAdmin) return null;

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
          <h1 className="text-xl font-semibold text-foreground">{ADMINISTRATIVO_PAGE_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{ADMINISTRATIVO_PAGE_SUBTITLE}</p>

        <div className="flex flex-col gap-4">
          <ModuleCard
            icon={CalendarDays}
            title={ESCALA_ADMIN_TITLE}
            description={ESCALA_ADMIN_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.ADMINISTRATIVO_ESCALA })}
          />
          <ModuleCard
            icon={ClipboardCheck}
            title={ADMINISTRATIVO_ATENDIMENTO_TITLE}
            description={ADMINISTRATIVO_ATENDIMENTO_CARD_DESCRIPTION}
            variant="brand-level-2"
            onClick={() => void navigate({ to: ROUTES.ADMINISTRATIVO_ATENDIMENTO })}
          />
          {permissaoTermos.podeGerenciar && (
            <ModuleCard
              icon={Tags}
              title={TERMOS_BUSCA_ADMIN_TITLE}
              description={TERMOS_BUSCA_ADMIN_CARD_DESCRIPTION}
              variant="brand-level-2"
              onClick={() => void navigate({ to: ROUTES.ADMINISTRATIVO_TERMOS_BUSCA })}
            />
          )}
        </div>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
