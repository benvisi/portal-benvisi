import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, UserMinus, UserPlus } from "lucide-react";

import { AtendimentoAtivoCard } from "@/components/atendimento/AtendimentoAtivoCard";
import { EmAtendimentoRow } from "@/components/atendimento/EmAtendimentoRow";
import { FechamentoAtendimento } from "@/components/atendimento/FechamentoAtendimento";
import { UnsavedDataConfirmDialog } from "@/components/atendimento/UnsavedDataConfirmDialog";
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
  ADMINISTRATOR_CARGO,
  ATENDIMENTO_PAGE_TITLE,
  ATENDIMENTO_START_BUTTON_LABEL,
  ATIVIDADES_NAO_INICIADAS_MESSAGE,
  DELEGATE_CONFIRM_ACCEPT_LABEL,
  DELEGATE_CONFIRM_CANCEL_LABEL,
  ENTRAR_LISTA_DA_VEZ_LABEL,
  FORA_DE_ORDEM_CONFIRM_ACCEPT_LABEL,
  FORA_DE_ORDEM_CONFIRM_CANCEL_LABEL,
  FORA_DE_ORDEM_CONFIRM_DESCRIPTION,
  FORA_DE_ORDEM_CONFIRM_TITLE,
  LISTA_DA_VEZ_EMPTY_MESSAGE,
  LISTA_DA_VEZ_FORA_DESCRIPTION,
  LISTA_DA_VEZ_FORA_TITLE,
  LISTA_DA_VEZ_TITLE,
  LISTA_DA_VEZ_VOCE_LABEL,
  MANAGER_CARGO,
  REMOVER_LISTA_DA_VEZ_ACCEPT_LABEL,
  SAIR_LISTA_DA_VEZ_LABEL,
  VOLTAR_AO_PAINEL_LABEL,
  getDelegateForaDeOrdemConfirmDescription,
  getDelegateForaDeOrdemConfirmTitle,
  getDelegateInOrderConfirmDescription,
  getDelegateInOrderConfirmTitle,
  getIniciarParaAriaLabel,
  getRemoverAriaLabel,
  getRemoverConfirmTitle,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { PendingChecklistIndicator } from "@/components/checklist/PendingChecklistIndicator";
import { useAtendimentoActions } from "@/hooks/useAtendimentoActions";
import { useAtendimentoAtivo } from "@/hooks/useAtendimentoAtivo";
import { useAtendimentoChecklist } from "@/hooks/useAtendimentoChecklist";
import { useAtendimentoMotivos } from "@/hooks/useAtendimentoMotivos";
import { useChecklistPolicy } from "@/hooks/useChecklistPolicy";
import { useFechamentoDraft } from "@/hooks/useFechamentoDraft";
import { useListaVez } from "@/hooks/useListaVez";
import { useListaVezActions } from "@/hooks/useListaVezActions";
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
  const motivosQuery = useAtendimentoMotivos(sessionToken);
  const checklistQuery = useAtendimentoChecklist(sessionToken);
  const checklistPolicyQuery = useChecklistPolicy(sessionToken);
  const actions = useAtendimentoActions(funcionarioId, sessionToken);
  const listaActions = useListaVezActions(funcionarioId, sessionToken);
  const shift = useShiftStart(funcionarioId, sessionToken);
  const draft = useFechamentoDraft();
  const { reset: resetDraft } = draft;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmVoltarPainelOpen, setConfirmVoltarPainelOpen] = useState(false);
  const [delegateAlvo, setDelegateAlvo] = useState<{ id: string; nome: string } | null>(null);
  const [delegateInOrderOpen, setDelegateInOrderOpen] = useState(false);
  const [delegateForaDeOrdemOpen, setDelegateForaDeOrdemOpen] = useState(false);
  const [removerAlvo, setRemoverAlvo] = useState<{ id: string; nome: string } | null>(null);
  const [removerOpen, setRemoverOpen] = useState(false);

  const emFinalizando = ativoQuery.data?.status === "finalizando";

  // The draft only makes sense while actually in the closing flow. Resetting
  // it whenever we're not in finalizando (rather than only on a specific
  // action) covers every path out — Voltar ao atendimento, a successful
  // final submission, or an initial mount before closing was ever entered —
  // so re-entering closing later always starts from a blank form instead of
  // resurrecting data the employee already discarded or submitted.
  // resetDraft is destructured out (not draft.reset used inline) so this
  // effect depends on the one stable function, not the whole draft object,
  // which is a fresh literal every render and would otherwise re-fire this
  // effect — and therefore call setClientes — on every single render.
  useEffect(() => {
    if (!emFinalizando) resetDraft();
  }, [emFinalizando, resetDraft]);

  if (!ready || !session) return null;

  const ativo = ativoQuery.data ?? null;
  const lista = listaQuery.data ?? [];
  const disponiveis = lista.filter((entry) => entry.status === "disponivel");
  const ocupados = lista.filter((entry) => entry.status !== "disponivel");
  const souPrimeiro = disponiveis.length > 0 && disponiveis[0].id_funcionario === funcionarioId;
  // Milestone 2A.2: presence in disponiveis (rather than a dedicated flag)
  // is enough to know whether the employee currently participates in Lista
  // da Vez — get_lista_vez_estado already excludes anyone who left/was
  // removed entirely, so absence here (once Iniciar Atividades is done and
  // the query has actually loaded) means "outside".
  const souNaFila = disponiveis.some((entry) => entry.id_funcionario === funcionarioId);
  const isManagerOrAdmin = session.cargo === ADMINISTRATOR_CARGO || session.cargo === MANAGER_CARGO;

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

  const handleVoltarPainelClick = () => {
    if (emFinalizando && draft.isDirty) {
      setConfirmVoltarPainelOpen(true);
      return;
    }
    void navigate({ to: ROUTES.DASHBOARD });
  };

  // Milestone 2A.1: starting an Atendimento for another employee. Unlike
  // self-start, an in-order delegated start still requires an explicit
  // (lightweight) confirmation naming the target — starting on someone
  // else's behalf is consequential enough to warrant it even when it
  // wouldn't be for yourself.
  const handleIniciarParaClick = (alvo: { id: string; nome: string }) => {
    const alvoEhPrimeiro = disponiveis[0]?.id_funcionario === alvo.id;
    setDelegateAlvo(alvo);
    if (alvoEhPrimeiro) {
      setDelegateInOrderOpen(true);
    } else {
      setDelegateForaDeOrdemOpen(true);
    }
  };

  const handleConfirmDelegateInOrder = async () => {
    if (!delegateAlvo) return;
    setDelegateInOrderOpen(false);
    // The frontend's "is first" snapshot can be stale (someone else changed
    // the queue between render and this confirm click) — exactly the same
    // race self-start already handles by escalating to the out-of-turn
    // dialog instead of failing silently.
    const result = await actions.iniciar(false, delegateAlvo.id);
    if (result === "requires_confirmation") {
      setDelegateForaDeOrdemOpen(true);
    } else {
      setDelegateAlvo(null);
    }
  };

  const handleConfirmDelegateForaDeOrdem = () => {
    if (!delegateAlvo) return;
    setDelegateForaDeOrdemOpen(false);
    void actions.iniciar(true, delegateAlvo.id);
    setDelegateAlvo(null);
  };

  const handleCancelarDelegado = (idAtendimento: string) => {
    void actions.cancelar(idAtendimento);
  };

  // Milestone 2A.2: voluntary leave/rejoin never need a confirmation dialog
  // — leaving only ever affects the caller's own state and is trivially
  // reversible with one more tap, so an extra "are you sure?" step would
  // just be friction (section 3.3 / section 14 "avoid unnecessary
  // confirmation"). Removing another employee does get one, below, since it
  // affects someone else.
  const handleSairClick = () => {
    void listaActions.sair();
  };

  const handleEntrarClick = () => {
    void listaActions.entrar();
  };

  const handleRemoverClick = (alvo: { id: string; nome: string }) => {
    setRemoverAlvo(alvo);
    setRemoverOpen(true);
  };

  const handleConfirmRemover = () => {
    if (!removerAlvo) return;
    setRemoverOpen(false);
    void listaActions.remover(removerAlvo.id);
    setRemoverAlvo(null);
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
            onClick={handleVoltarPainelClick}
            aria-label={VOLTAR_AO_PAINEL_LABEL}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="text-xl font-semibold text-foreground">{ATENDIMENTO_PAGE_TITLE}</h1>
        </header>

        {/*
          Milestone 2C.2: now the same shared, actionable indicator used on
          the dashboard — tapping it opens the standalone checklist
          completion flow. Superseded the 2C.1 awareness-only banner that
          used to live here directly (avoids showing the count twice per
          section 29).
        */}
        <PendingChecklistIndicator funcionarioId={funcionarioId} sessionToken={sessionToken} />

        {ativo?.status === "finalizando" ? (
          <FechamentoAtendimento
            draft={draft}
            motivos={motivosQuery.data ?? []}
            motivosLoading={motivosQuery.isLoading}
            checklistItens={checklistQuery.data ?? []}
            checklistLoading={checklistQuery.isLoading}
            checklistPolicy={checklistPolicyQuery.data}
            checklistObrigatorio={ativo?.checklist_obrigatorio ?? null}
            submitting={actions.submitting}
            errorMessage={actions.errorMessage}
            onVoltar={() => void actions.voltarAoAtendimento()}
            onConcluir={(clientes, checklist) => void actions.concluir(clientes, checklist)}
            onFareiDepois={(clientes) => void actions.adiarChecklist(clientes)}
          />
        ) : ativo ? (
          <AtendimentoAtivoCard
            foraDeOrdem={ativo.fora_de_ordem}
            prazoProvisorioEm={ativo.prazo_provisorio_em}
            iniciadoPorNome={ativo.iniciado_por_nome}
            submitting={actions.submitting}
            errorMessage={actions.errorMessage}
            onCancelarProvisorio={() => void actions.cancelar(ativo.id)}
            onIniciarFechamento={() => void actions.iniciarFechamento()}
          />
        ) : !shift.isLoading && shift.startedToday && !listaQuery.isLoading && !souNaFila ? (
          // Milestone 2A.2: activities were already started today, but the
          // employee currently isn't a Lista da Vez participant (voluntary
          // leave or manager/admin removal). Iniciar atendimento is hidden
          // rather than shown-disabled here — the backend would reject a
          // self-start while outside the queue anyway (the same
          // disponivel = true guard 2A.1 added to iniciar_atendimento), so a
          // disabled decoy button next to Entrar would just be confusing.
          <Card className="flex flex-col gap-4 border-warning/40 bg-warning/10 p-6 shadow-card">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-warning">{LISTA_DA_VEZ_FORA_TITLE}</p>
              <p className="text-sm text-muted-foreground">{LISTA_DA_VEZ_FORA_DESCRIPTION}</p>
            </div>
            <Button
              type="button"
              size="lg"
              className="min-touch w-full bg-warning text-warning-foreground hover:bg-warning/90"
              disabled={listaActions.submitting}
              onClick={handleEntrarClick}
            >
              {listaActions.submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                ENTRAR_LISTA_DA_VEZ_LABEL
              )}
            </Button>
            {listaActions.errorMessage && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {listaActions.errorMessage}
              </p>
            )}
          </Card>
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
            {!shift.isLoading && shift.startedToday && !listaQuery.isLoading && souNaFila && (
              // Visually secondary — must not compete with Iniciar
              // atendimento above it (section 14). Not a destructive/red
              // treatment: unlike Cancelar início/Desfazer, leaving Lista da
              // Vez isn't undoing an accidental action, it's a normal,
              // reversible availability change.
              <Button
                type="button"
                variant="ghost"
                className="min-touch w-full text-muted-foreground hover:text-foreground"
                disabled={listaActions.submitting}
                onClick={handleSairClick}
              >
                {listaActions.submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  SAIR_LISTA_DA_VEZ_LABEL
                )}
              </Button>
            )}
            {actions.errorMessage && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {actions.errorMessage}
              </p>
            )}
            {listaActions.errorMessage && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {listaActions.errorMessage}
              </p>
            )}
          </Card>
        )}

        <Card className="flex flex-col gap-4 p-6 shadow-card">
          <h2 className="text-base font-semibold text-foreground">{LISTA_DA_VEZ_TITLE}</h2>

          {/*
            Delegate-start/delegate-cancel actions (Milestone 2A.1) originate
            from this card, not from the ativo/finalizando/start card above,
            which has its own errorMessage display for its own actions — an
            error here would otherwise have nowhere to surface and fail
            silently (e.g. the target became unavailable between the confirm
            dialog and the RPC call).
          */}
          {actions.errorMessage && (
            <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
              {actions.errorMessage}
            </p>
          )}
          {listaActions.errorMessage && (
            <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
              {listaActions.errorMessage}
            </p>
          )}

          {listaQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">{LISTA_DA_VEZ_EMPTY_MESSAGE}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {disponiveis.map((entry) => {
                const souEu = entry.id_funcionario === funcionarioId;
                return (
                  <li
                    key={entry.id_funcionario}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                      {entry.ordem}
                    </span>
                    <span className="text-sm font-medium text-foreground">{entry.nome}</span>
                    {souEu ? (
                      <Badge variant="outline" className="ml-auto">
                        {LISTA_DA_VEZ_VOCE_LABEL}
                      </Badge>
                    ) : (
                      <div className="ml-auto flex items-center gap-1">
                        {isManagerOrAdmin && (
                          // Manager/admin exception action (Milestone 2A.2,
                          // section 15) — UserMinus is deliberately a
                          // different silhouette from Iniciar atendimento's
                          // UserPlus below (they looked too similar at
                          // mobile icon sizes with a shared UserX/UserPlus
                          // pairing), and destructive-red by default (not
                          // just on hover) so this reads as the cautionary
                          // action at a glance. Never shown on the
                          // employee's own row (that's what Sair da Lista
                          // da Vez, above, is for) or on Em
                          // atendimento/Finalizando rows (those render via
                          // EmAtendimentoRow instead, not this branch).
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-touch h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() =>
                              handleRemoverClick({ id: entry.id_funcionario, nome: entry.nome })
                            }
                            aria-label={getRemoverAriaLabel(entry.nome)}
                          >
                            <UserMinus className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="min-touch h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            handleIniciarParaClick({ id: entry.id_funcionario, nome: entry.nome })
                          }
                          aria-label={getIniciarParaAriaLabel(entry.nome)}
                        >
                          <UserPlus className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
              {ocupados.map((entry) => (
                <EmAtendimentoRow
                  key={entry.id_funcionario}
                  nome={entry.nome}
                  status={entry.status === "finalizando" ? "finalizando" : "em_atendimento"}
                  iniciadoEm={entry.iniciado_em}
                  souEu={entry.id_funcionario === funcionarioId}
                  idAtendimento={entry.id_atendimento}
                  prazoProvisorioEm={entry.prazo_provisorio_em}
                  podeCancelarComoIniciador={
                    entry.id_funcionario_iniciador === funcionarioId &&
                    entry.id_funcionario_iniciador !== entry.id_funcionario
                  }
                  cancelando={actions.submitting}
                  onCancelarInicio={handleCancelarDelegado}
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

      <UnsavedDataConfirmDialog
        open={confirmVoltarPainelOpen}
        onOpenChange={setConfirmVoltarPainelOpen}
        onConfirmDiscard={() => {
          setConfirmVoltarPainelOpen(false);
          void navigate({ to: ROUTES.DASHBOARD });
        }}
      />

      <AlertDialog open={delegateInOrderOpen} onOpenChange={setDelegateInOrderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {delegateAlvo ? getDelegateInOrderConfirmTitle(delegateAlvo.nome) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {delegateAlvo ? getDelegateInOrderConfirmDescription(delegateAlvo.nome) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{DELEGATE_CONFIRM_CANCEL_LABEL}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmDelegateInOrder()}>
              {DELEGATE_CONFIRM_ACCEPT_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={delegateForaDeOrdemOpen} onOpenChange={setDelegateForaDeOrdemOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {delegateAlvo ? getDelegateForaDeOrdemConfirmTitle(delegateAlvo.nome) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {delegateAlvo ? getDelegateForaDeOrdemConfirmDescription(delegateAlvo.nome) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{DELEGATE_CONFIRM_CANCEL_LABEL}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelegateForaDeOrdem}>
              {DELEGATE_CONFIRM_ACCEPT_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removerOpen} onOpenChange={setRemoverOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removerAlvo ? getRemoverConfirmTitle(removerAlvo.nome) : ""}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{DELEGATE_CONFIRM_CANCEL_LABEL}</AlertDialogCancel>
            <AlertDialogAction
              className="border border-destructive/40 bg-transparent text-destructive shadow-none hover:bg-destructive/10"
              onClick={handleConfirmRemover}
            >
              {REMOVER_LISTA_DA_VEZ_ACCEPT_LABEL}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
