import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { TermosBuscaGerenciarView } from "@/components/termosBusca/TermosBuscaGerenciarView";
import { TermosBuscaPendentesView } from "@/components/termosBusca/TermosBuscaPendentesView";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TERMOS_BUSCA_ADMIN_TAB_GERENCIAR_LABEL,
  TERMOS_BUSCA_ADMIN_TAB_PENDENTES_LABEL,
  TERMOS_BUSCA_ADMIN_TITLE,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useTermosBuscaPermissao } from "@/hooks/useTermosBuscaPermissao";

export const Route = createFileRoute("/administrativo/termos-busca")({
  head: () => ({
    meta: [
      { title: "Termos de busca — Administrativo — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TermosBuscaAdminPage,
});

// Termos de busca V1 management area: Pendentes (moderation queue) and
// Gerenciar termos (per-produto add/deactivate/reactivate). Access is the
// explicit funcionarios.pode_gerenciar_termos_busca capability — NOT cargo —
// so the gate here is the permission RPC rather than the ADMINISTRATOR_CARGO
// check the other /administrativo pages use. As everywhere else, the
// client-side redirect is UX only: every management RPC re-checks the
// capability server-side. Back goes to Consulta de Estoque, the entry point
// that is reachable by every capability holder regardless of cargo.
function TermosBuscaAdminPage() {
  const navigate = useNavigate();
  const goBack = useGoBack(ROUTES.ESTOQUE);
  const { session, ready } = useRequireSession();
  const sessionToken = session?.session_token ?? null;
  const permissao = useTermosBuscaPermissao(sessionToken);
  const [abaSelecionada, setAbaSelecionada] = useState("pendentes");

  useEffect(() => {
    if (ready && session && permissao.isSuccess && !permissao.podeGerenciar) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [ready, session, permissao.isSuccess, permissao.podeGerenciar, navigate]);

  if (!ready || !session || sessionToken === null) return null;

  if (permissao.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      </main>
    );
  }

  if (!permissao.podeGerenciar) return null;

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
          <h1 className="text-xl font-semibold text-foreground">{TERMOS_BUSCA_ADMIN_TITLE}</h1>
        </header>

        <Tabs value={abaSelecionada} onValueChange={setAbaSelecionada}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1">
            <TabsTrigger value="pendentes" className="min-h-11">
              {TERMOS_BUSCA_ADMIN_TAB_PENDENTES_LABEL}
            </TabsTrigger>
            <TabsTrigger value="gerenciar" className="min-h-11">
              {TERMOS_BUSCA_ADMIN_TAB_GERENCIAR_LABEL}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pendentes" className="mt-4">
            <TermosBuscaPendentesView
              sessionToken={sessionToken}
              active={abaSelecionada === "pendentes"}
            />
          </TabsContent>

          <TabsContent value="gerenciar" className="mt-4">
            <TermosBuscaGerenciarView sessionToken={sessionToken} />
          </TabsContent>
        </Tabs>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
