import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { ContagemHistoricoView } from "@/components/contagem/ContagemHistoricoView";
import { ContagemPendentesView } from "@/components/contagem/ContagemPendentesView";
import { NovaContagemView } from "@/components/contagem/NovaContagemView";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADMINISTRATOR_CARGO,
  CONTAGEM_EMBALAGENS_PAGE_SUBTITLE,
  CONTAGEM_EMBALAGENS_TITLE,
  CONTAGEM_TAB_HISTORICO_LABEL,
  CONTAGEM_TAB_NOVA_LABEL,
  CONTAGEM_TAB_PENDENTES_LABEL,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useRequireSession } from "@/hooks/useRequireSession";

export const Route = createFileRoute("/operacoes/contagem-embalagens")({
  head: () => ({
    meta: [
      { title: "Contagem de Embalagens — Portal Benvisi" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContagemEmbalagensPage,
});

// Milestone 4D: Operações → Contagem de Embalagens V1. A regular employee
// sees only the counting form ("Nova contagem"). An Administrador gets the
// same form plus the review queue (Pendentes) and Histórico as tabs. The
// server enforces both the submitter identity and the Administrador-only
// review RPCs — the role check here is UX, not authorization.
function ContagemEmbalagensPage() {
  const navigate = useNavigate();
  const { session, ready } = useRequireSession();
  const [aba, setAba] = useState("nova");

  if (!ready || !session) return null;

  const isAdmin = session.cargo === ADMINISTRATOR_CARGO;
  const sessionToken = session.session_token;
  const apelido = session.apelido || session.nome;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-touch shrink-0"
            onClick={() => void navigate({ to: ROUTES.OPERACOES })}
            aria-label={VOLTAR_A_OPERACOES_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{CONTAGEM_EMBALAGENS_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{CONTAGEM_EMBALAGENS_PAGE_SUBTITLE}</p>

        {isAdmin ? (
          <Tabs value={aba} onValueChange={setAba}>
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1">
              <TabsTrigger value="nova" className="min-h-11">
                {CONTAGEM_TAB_NOVA_LABEL}
              </TabsTrigger>
              <TabsTrigger value="pendentes" className="min-h-11">
                {CONTAGEM_TAB_PENDENTES_LABEL}
              </TabsTrigger>
              <TabsTrigger value="historico" className="min-h-11">
                {CONTAGEM_TAB_HISTORICO_LABEL}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="nova" className="mt-4">
              <NovaContagemView sessionToken={sessionToken} apelido={apelido} />
            </TabsContent>
            <TabsContent value="pendentes" className="mt-4">
              <ContagemPendentesView sessionToken={sessionToken} active={aba === "pendentes"} />
            </TabsContent>
            <TabsContent value="historico" className="mt-4">
              <ContagemHistoricoView sessionToken={sessionToken} active={aba === "historico"} />
            </TabsContent>
          </Tabs>
        ) : (
          <NovaContagemView sessionToken={sessionToken} apelido={apelido} />
        )}
      </div>

      <AuthUtilityBar />
    </main>
  );
}
