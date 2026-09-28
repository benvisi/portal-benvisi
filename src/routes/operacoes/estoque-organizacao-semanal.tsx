import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { EstoqueOrganizacaoGerencialView } from "@/components/estoqueOrganizacao/EstoqueOrganizacaoGerencialView";
import { EstoqueOrganizacaoSemanaView } from "@/components/estoqueOrganizacao/EstoqueOrganizacaoSemanaView";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADMINISTRATOR_CARGO,
  ESTOQUE_ORGANIZACAO_PAGE_SUBTITLE,
  ESTOQUE_ORGANIZACAO_TAB_GERENCIAR_LABEL,
  ESTOQUE_ORGANIZACAO_TAB_SEMANA_LABEL,
  ESTOQUE_ORGANIZACAO_TITLE,
  MANAGER_CARGO,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { getManausDateISO } from "@/lib/escala";
import { weekStartISO } from "@/lib/estoqueOrganizacao";

export const Route = createFileRoute("/operacoes/estoque-organizacao-semanal")({
  head: () => ({
    meta: [
      { title: "Organização Semanal — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EstoqueOrganizacaoSemanalPage,
});

// V1: Semana always visible (team transparency); Gerenciar only for
// Gerente/Administrador — same client-redirect-is-UX-only convention as
// Limpeza/Escala; every management RPC re-checks cargo server-side.
function EstoqueOrganizacaoSemanalPage() {
  const goBack = useGoBack(ROUTES.OPERACOES);
  const { session, ready } = useRequireSession();
  const [abaSelecionada, setAbaSelecionada] = useState("semana");
  const [semanaSelecionada, setSemanaSelecionada] = useState(weekStartISO(getManausDateISO()));

  if (!ready || !session) return null;

  const sessionToken = session.session_token;
  const isManagerOrAdmin = session.cargo === ADMINISTRATOR_CARGO || session.cargo === MANAGER_CARGO;

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
            aria-label={VOLTAR_A_OPERACOES_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{ESTOQUE_ORGANIZACAO_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{ESTOQUE_ORGANIZACAO_PAGE_SUBTITLE}</p>

        <Tabs value={abaSelecionada} onValueChange={setAbaSelecionada}>
          <TabsList
            className={`grid h-auto w-full gap-1 ${isManagerOrAdmin ? "grid-cols-2" : "grid-cols-1"}`}
          >
            <TabsTrigger value="semana" className="min-h-11">
              {ESTOQUE_ORGANIZACAO_TAB_SEMANA_LABEL}
            </TabsTrigger>
            {isManagerOrAdmin && (
              <TabsTrigger value="gerenciar" className="min-h-11">
                {ESTOQUE_ORGANIZACAO_TAB_GERENCIAR_LABEL}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="semana" className="mt-4">
            <EstoqueOrganizacaoSemanaView
              sessionToken={sessionToken}
              funcionarioLogadoId={session.funcionario_id}
            />
          </TabsContent>

          {isManagerOrAdmin && (
            <TabsContent value="gerenciar" className="mt-4">
              <EstoqueOrganizacaoGerencialView
                sessionToken={sessionToken}
                semanaSelecionada={semanaSelecionada}
                onSemanaSelecionadaChange={setSemanaSelecionada}
                ativo={abaSelecionada === "gerenciar"}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
