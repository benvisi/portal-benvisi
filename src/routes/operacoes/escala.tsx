import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { EscalaHojeView } from "@/components/escala/EscalaHojeView";
import { EscalaMesView } from "@/components/escala/EscalaMesView";
import { EscalaSemanaView } from "@/components/escala/EscalaSemanaView";
import { AuthUtilityBar } from "@/components/layout/AuthUtilityBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ESCALA_PAGE_SUBTITLE,
  ESCALA_TAB_DIA_LABEL,
  ESCALA_TAB_MES_LABEL,
  ESCALA_TAB_SEMANA_LABEL,
  ESCALA_TITLE,
  VOLTAR_A_OPERACOES_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useRequireSession } from "@/hooks/useRequireSession";
import { getManausDateISO, monthStartISO } from "@/lib/escala";

export const Route = createFileRoute("/operacoes/escala")({
  head: () => ({
    meta: [{ title: "Escala — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: EscalaPage,
});

// Milestone 4C.1: Dia / Semana / Mês as tabs within one page rather than
// three routes — a single lightweight client-side switch, consistent with
// "Do not introduce duplicate navigation concepts". The selected date is
// shared state at this level so switching from Dia to Semana carries the
// same reference date across, rather than resetting. The active tab is also
// state here so Mês can send the user to Dia for a specific day (4C.2 QA).
function EscalaPage() {
  const navigate = useNavigate();
  const { session, ready } = useRequireSession();
  const hojeISO = getManausDateISO();
  const [abaSelecionada, setAbaSelecionada] = useState("dia");
  const [dataSelecionada, setDataSelecionada] = useState(hojeISO);
  const [mesSelecionado, setMesSelecionado] = useState(monthStartISO(hojeISO));

  if (!ready || !session) return null;

  const sessionToken = session.session_token;
  const funcionarioLogadoId = session.funcionario_id;

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
          <h1 className="text-xl font-semibold text-foreground">{ESCALA_TITLE}</h1>
        </header>

        <p className="text-sm text-muted-foreground">{ESCALA_PAGE_SUBTITLE}</p>

        <Tabs value={abaSelecionada} onValueChange={setAbaSelecionada}>
          {/*
            TabsList's base style fixes h-9 (36px). Milestone 4C.2 QA found
            the active segment visually overflowing that box on desktop —
            root cause: giving each trigger min-touch (min-height: 44px)
            made it taller than its own fixed-height parent, so it
            protruded above/below the gray container instead of sitting
            inside it. Fix: let the list's height be intrinsic (h-auto) and
            size the touch target on the triggers themselves (min-h-11),
            so the container grows to fit all three segments cleanly
            instead of clipping/overflowing one of them.
          */}
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1">
            <TabsTrigger value="dia" className="min-h-11">
              {ESCALA_TAB_DIA_LABEL}
            </TabsTrigger>
            <TabsTrigger value="semana" className="min-h-11">
              {ESCALA_TAB_SEMANA_LABEL}
            </TabsTrigger>
            <TabsTrigger value="mes" className="min-h-11">
              {ESCALA_TAB_MES_LABEL}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dia" className="mt-4">
            <EscalaHojeView
              sessionToken={sessionToken}
              funcionarioLogadoId={funcionarioLogadoId}
              dataSelecionada={dataSelecionada}
              onDataSelecionadaChange={setDataSelecionada}
            />
          </TabsContent>

          <TabsContent value="semana" className="mt-4">
            <EscalaSemanaView
              sessionToken={sessionToken}
              funcionarioLogadoId={funcionarioLogadoId}
              dataInicio={dataSelecionada}
            />
          </TabsContent>

          <TabsContent value="mes" className="mt-4">
            <EscalaMesView
              sessionToken={sessionToken}
              mesSelecionado={mesSelecionado}
              onMesSelecionadoChange={setMesSelecionado}
              onDiaSelecionado={(data) => {
                setDataSelecionada(data);
                setMesSelecionado(monthStartISO(data));
                setAbaSelecionada("dia");
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      <AuthUtilityBar />
    </main>
  );
}
