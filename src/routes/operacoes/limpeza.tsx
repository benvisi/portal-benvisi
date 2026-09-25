import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { LimpezaDiaView } from "@/components/limpeza/LimpezaDiaView";
import { LimpezaGerencialView } from "@/components/limpeza/LimpezaGerencialView";
import { LimpezaMesView } from "@/components/limpeza/LimpezaMesView";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADMINISTRATOR_CARGO,
  LIMPEZA_PAGE_SUBTITLE,
  LIMPEZA_TAB_GERENCIAR_LABEL,
  LIMPEZA_TAB_HOJE_LABEL,
  LIMPEZA_TAB_MES_LABEL,
  LIMPEZA_TITLE,
  MANAGER_CARGO,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useGoBack } from "@/hooks/useGoBack";
import { useRequireSession } from "@/hooks/useRequireSession";
import { getManausDateISO, monthStartISO } from "@/lib/escala";

export const Route = createFileRoute("/operacoes/limpeza")({
  head: () => ({
    meta: [{ title: "Limpeza — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: LimpezaPage,
});

// V1: Hoje / Mês always visible (team transparency); Gerenciar only for
// Gerente/Administrador — same client-redirect-is-UX-only convention as the
// rest of the app, every management RPC re-checks cargo server-side.
// Deliberately stays under /operacoes rather than /administrativo: that hub
// is Administrador-only by existing convention (see administrativo/index.tsx
// and administrativo/escala.tsx), and Gerente needs the Gerenciar tab too.
function LimpezaPage() {
  const goBack = useGoBack(ROUTES.OPERACOES);
  const { session, ready } = useRequireSession();
  const hojeISO = getManausDateISO();
  const [abaSelecionada, setAbaSelecionada] = useState("hoje");
  const [dataSelecionada, setDataSelecionada] = useState(hojeISO);
  const [mesSelecionado, setMesSelecionado] = useState(monthStartISO(hojeISO));

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
          <h1 className="text-xl font-semibold text-foreground">{LIMPEZA_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{LIMPEZA_PAGE_SUBTITLE}</p>

        <Tabs value={abaSelecionada} onValueChange={setAbaSelecionada}>
          <TabsList
            className={`grid h-auto w-full gap-1 ${isManagerOrAdmin ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <TabsTrigger value="hoje" className="min-h-11">
              {LIMPEZA_TAB_HOJE_LABEL}
            </TabsTrigger>
            <TabsTrigger value="mes" className="min-h-11">
              {LIMPEZA_TAB_MES_LABEL}
            </TabsTrigger>
            {isManagerOrAdmin && (
              <TabsTrigger value="gerenciar" className="min-h-11">
                {LIMPEZA_TAB_GERENCIAR_LABEL}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="hoje" className="mt-4">
            <LimpezaDiaView
              sessionToken={sessionToken}
              funcionarioLogadoId={session.funcionario_id}
              isManagerOrAdmin={isManagerOrAdmin}
              dataSelecionada={dataSelecionada}
              onDataSelecionadaChange={setDataSelecionada}
            />
          </TabsContent>

          <TabsContent value="mes" className="mt-4">
            <LimpezaMesView
              sessionToken={sessionToken}
              mesSelecionado={mesSelecionado}
              onMesSelecionadoChange={setMesSelecionado}
            />
          </TabsContent>

          {isManagerOrAdmin && (
            <TabsContent value="gerenciar" className="mt-4">
              <LimpezaGerencialView
                sessionToken={sessionToken}
                mesSelecionado={mesSelecionado}
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
