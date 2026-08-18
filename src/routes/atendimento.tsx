import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { AtendimentoAtivoCard } from "@/components/atendimento/AtendimentoAtivoCard";
import { EmAtendimentoRow } from "@/components/atendimento/EmAtendimentoRow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ATENDIMENTO_PAGE_TITLE,
  ATENDIMENTO_START_BUTTON_LABEL,
  ATIVIDADES_NAO_INICIADAS_MESSAGE,
  FORA_DE_ORDEM_CONFIRM_ACCEPT_LABEL,
  FORA_DE_ORDEM_CONFIRM_CANCEL_LABEL,
  FORA_DE_ORDEM_CONFIRM_DESCRIPTION,
  FORA_DE_ORDEM_CONFIRM_TITLE,
  LISTA_DA_VEZ_EMPTY_MESSAGE,
  LISTA_DA_VEZ_TITLE,
  LISTA_DA_VEZ_VOCE_LABEL,
  VOLTAR_AO_PAINEL_LABEL,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { useAtendimentoActions } from "@/hooks/useAtendimentoActions";
import { useAtendimentoAtivo } from "@/hooks/useAtendimentoAtivo";
import { useListaVez } from "@/hooks/useListaVez";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useShiftStart } from "@/hooks/useShiftStart";

export const Route = createFileRoute("/atendimento")({
  head: () => ({
    meta: [{ title: "Atendimento — Portal Benvisi" }, { name: "robots", content: "noindex" }],
  }),
  component: AtendimentoPage,
});

function AtendimentoPage() {
  const navigate = useNavigate();
  const { session, ready } = useRequireSession();
  const funcionarioId = session?.funcionario_id ?? null;
  const sessionToken = session?.session_token ?? null;

  const ativoQuery = useAtendimentoAtivo(funcionarioId, sessionToken);
  const listaQuery = useListaVez(funcionarioId, sessionToken);
  const actions = useAtendimentoActions(funcionarioId, sessionToken);
  const shift = useShiftStart(funcionarioId, sessionToken);

  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!ready || !session) return null;

  const ativo = ativoQuery.data ?? null;
  const lista = listaQuery.data ?? [];
  const disponiveis = lista.filter((entry) => !entry.em_atendimento);
  const emAtendimento = lista.filter((entry) => entry.em_atendimento);
  const souPrimeiro = disponiveis.length > 0 && disponiveis[0].id_funcionario === funcionarioId;

  const handleStartClick = async () => {
    // Iniciar Atividades eligibility is checked first, before any Lista da
    // Vez / out-of-turn logic: an employee who hasn't started activities
    // isn't a queue member at all, so "am I first" is not the relevant
    // question yet. This mirrors the server's own check order in
    // iniciar_atendimento (ATIVIDADES_NAO_INICIADAS is raised before the
    // queue is ever consulted) — this is a UX guard on top of that
    // authoritative backend check, not a replacement for it.
    if (!shift.startedToday) return;

    if (!souPrimeiro) {
      setConfirmOpen(true);
      return;
    }
    // Even though the client believes it is first, the server re-checks
    // against the authoritative queue state: if it disagrees (a race with
    // another employee's action), it asks for the same out-of-turn
    // confirmation the client would have shown for a known non-first start.
    const result = await actions.iniciar(false);
    if (result === "requires_confirmation") setConfirmOpen(true);
  };

  const handleConfirmForaDeOrdem = () => {
    setConfirmOpen(false);
    void actions.iniciar(true);
  };

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
          <h1 className="text-xl font-semibold text-foreground">{ATENDIMENTO_PAGE_TITLE}</h1>
        </header>

        {ativo ? (
          <AtendimentoAtivoCard
            foraDeOrdem={ativo.fora_de_ordem}
            prazoProvisorioEm={ativo.prazo_provisorio_em}
            submitting={actions.submitting}
            errorMessage={actions.errorMessage}
            onCancelarProvisorio={() => void actions.cancelar()}
            onConcluir={() => void actions.concluir()}
          />
        ) : (
          <Card className="flex flex-col gap-4 p-6 shadow-card">
            <Button
              type="button"
              size="lg"
              className="min-touch w-full"
              disabled={
                actions.submitting || ativoQuery.isLoading || shift.isLoading || !shift.startedToday
              }
              onClick={() => void handleStartClick()}
            >
              {actions.submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                ATENDIMENTO_START_BUTTON_LABEL
              )}
            </Button>
            {!shift.isLoading && !shift.startedToday && (
              <p className="text-sm font-medium text-muted-foreground">
                {ATIVIDADES_NAO_INICIADAS_MESSAGE}
              </p>
            )}
            {actions.errorMessage && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {actions.errorMessage}
              </p>
            )}
          </Card>
        )}

        <Card className="flex flex-col gap-4 p-6 shadow-card">
          <h2 className="text-base font-semibold text-foreground">{LISTA_DA_VEZ_TITLE}</h2>

          {listaQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">{LISTA_DA_VEZ_EMPTY_MESSAGE}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {disponiveis.map((entry) => (
                <li
                  key={entry.id_funcionario}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {entry.ordem}
                  </span>
                  <span className="text-sm font-medium text-foreground">{entry.nome}</span>
                  {entry.id_funcionario === funcionarioId && (
                    <Badge variant="outline" className="ml-auto">
                      {LISTA_DA_VEZ_VOCE_LABEL}
                    </Badge>
                  )}
                </li>
              ))}
              {emAtendimento.map((entry) => (
                <EmAtendimentoRow
                  key={entry.id_funcionario}
                  nome={entry.nome}
                  iniciadoEm={entry.iniciado_em}
                  souEu={entry.id_funcionario === funcionarioId}
                />
              ))}
            </ol>
          )}
        </Card>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{FORA_DE_ORDEM_CONFIRM_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>{FORA_DE_ORDEM_CONFIRM_DESCRIPTION}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{FORA_DE_ORDEM_CONFIRM_CANCEL_LABEL}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmForaDeOrdem}>
              {FORA_DE_ORDEM_CONFIRM_ACCEPT_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
