import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { EscalaAdminHistoricoView } from "@/components/escalaAdmin/EscalaAdminHistoricoView";
import { EscalaAdminUploadView } from "@/components/escalaAdmin/EscalaAdminUploadView";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADMINISTRATOR_CARGO,
  ESCALA_ADMIN_TAB_ENVIAR_LABEL,
  ESCALA_ADMIN_TAB_HISTORICO_LABEL,
  ESCALA_ADMIN_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/administrativo/escala")({
  head: () => ({
    meta: [
      { title: "Escala — Administrativo — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EscalaAdminPage,
});

// V1.1: one route, role-gated tabs (Enviar escala / Histórico) — the same
// shape already established by Contagem de Embalagens' Pendentes/Histórico
// tabs, and the same client-side-redirect-is-UX-only pattern already used by
// /administrativo: escala_processar_importacao and
// get_escala_publicacoes_historico both independently re-check
// cargo = 'Administrador' server-side regardless of how this page is
// reached.
function EscalaAdminPage() {
  const navigate = useNavigate();
  const goBack = useGoBack(ROUTES.ADMINISTRATIVO);
  const { session, ready } = useRequireSession();
  const isAdmin = session?.cargo === ADMINISTRATOR_CARGO;
  const [abaSelecionada, setAbaSelecionada] = useState("enviar");

  useEffect(() => {
    if (ready && session && !isAdmin) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [ready, session, isAdmin, navigate]);

  if (!ready || !session || !isAdmin) return null;

  const sessionToken = session.session_token;

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
          <h1 className="text-xl font-semibold text-foreground">{ESCALA_ADMIN_TITLE}</h1>
        </header>

        <Tabs value={abaSelecionada} onValueChange={setAbaSelecionada}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1">
            <TabsTrigger value="enviar" className="min-h-11">
              {ESCALA_ADMIN_TAB_ENVIAR_LABEL}
            </TabsTrigger>
            <TabsTrigger value="historico" className="min-h-11">
              {ESCALA_ADMIN_TAB_HISTORICO_LABEL}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="enviar" className="mt-4">
            <EscalaAdminUploadView sessionToken={sessionToken} />
          </TabsContent>

          <TabsContent value="historico" className="mt-4">
            <EscalaAdminHistoricoView
              sessionToken={sessionToken}
              active={abaSelecionada === "historico"}
            />
          </TabsContent>
        </Tabs>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
