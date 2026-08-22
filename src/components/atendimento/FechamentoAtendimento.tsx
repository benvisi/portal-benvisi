import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { ChecklistItemRow } from "@/components/atendimento/ChecklistItemRow";
import { ClienteCard } from "@/components/atendimento/ClienteCard";
import { UnsavedDataConfirmDialog } from "@/components/atendimento/UnsavedDataConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ADICIONAR_CLIENTE_LABEL,
  ATENDIMENTO_PENDENTE_SUBTITLE,
  ATENDIMENTO_PENDENTE_TITLE,
  CHECKLIST_LOADING_MESSAGE,
  CHECKLIST_OBRIGATORIO_PERIODICO_MESSAGE,
  CHECKLIST_SUBTITLE,
  CHECKLIST_TITLE,
  FAREI_DEPOIS_LABEL,
  FAREI_DEPOIS_SUPPORT_TEXT,
  FECHAMENTO_SUBMIT_LABEL,
  FECHAMENTO_SUBTITLE,
  FECHAMENTO_TITLE,
  VOLTAR_AO_ATENDIMENTO_LABEL,
  getAtendimentoPendenteDataLabel,
} from "@/config/constants";
import type {
  AtendimentoChecklistItem,
  AtendimentoMotivo,
  ChecklistPolicy,
} from "@/integrations/supabase/contracts";
import type { ClienteRascunho, FechamentoDraft } from "@/hooks/useFechamentoDraft";
import type { ChecklistRespostaInput, ClienteOutcomeInput } from "@/hooks/useAtendimentoActions";

interface FechamentoAtendimentoProps {
  draft: FechamentoDraft;
  motivos: AtendimentoMotivo[];
  motivosLoading: boolean;
  checklistItens: AtendimentoChecklistItem[];
  checklistLoading: boolean;
  checklistPolicy: ChecklistPolicy | undefined;
  // Milestone 2C.3: this specific Atendimento's own persisted
  // periodic-verification decision, if any — null means no decision was
  // ever made for it (governed by required/defer_allowed at every
  // Finalizando entry so far), in which case checklistPolicy is what
  // decides Farei depois availability, exactly as in 2C.1/2C.2.
  checklistObrigatorio: boolean | null;
  // Milestone 2D: renders this Atendimento's closing as previous-day
  // recovery (section 9/12) instead of an ordinary same-day Finalizando —
  // Farei depois is unconditionally unavailable and the internal Voltar ao
  // atendimento action is hidden (there is no live "active" state to return
  // to), regardless of checklistObrigatorio/checklistPolicy. onVoltar is
  // simply never invoked in this mode; callers pass a no-op.
  isPendingRecovery?: boolean;
  // The original Atendimento's Manaus business day, pre-formatted as
  // "DD/MM" — only used (and only rendered) when isPendingRecovery is true.
  diaOriginalFormatado?: string | null;
  submitting: boolean;
  errorMessage: string | null;
  onVoltar: () => void;
  onConcluir: (clientes: ClienteOutcomeInput[], checklist: ChecklistRespostaInput[]) => void;
  onFareiDepois: (clientes: ClienteOutcomeInput[]) => void;
}

function isClienteCompleto(cliente: ClienteRascunho, motivos: AtendimentoMotivo[]): boolean {
  if (!cliente.categoria || !cliente.idMotivo) return false;
  const motivo = motivos.find((m) => m.id === cliente.idMotivo);
  if (!motivo) return false;
  if (motivo.detalhe_obrigatorio && cliente.detalhe.trim().length === 0) return false;
  return true;
}

export function FechamentoAtendimento({
  draft,
  motivos,
  motivosLoading,
  checklistItens,
  checklistLoading,
  checklistPolicy,
  checklistObrigatorio,
  isPendingRecovery = false,
  diaOriginalFormatado = null,
  submitting,
  errorMessage,
  onVoltar,
  onConcluir,
  onFareiDepois,
}: FechamentoAtendimentoProps) {
  const [confirmVoltarOpen, setConfirmVoltarOpen] = useState(false);

  const clientesValidos = draft.clientes.every((c) => isClienteCompleto(c, motivos));
  const checklistValido =
    checklistItens.length > 0 &&
    checklistItens.every((item) => draft.checklist[item.codigo] === true);
  const formValido = clientesValidos && checklistValido;
  // Milestone 2C.1/2C.3: Farei depois is never inferred from an incomplete
  // checklist, always an explicit separate action, and still requires
  // valid customer data (section 10). Availability: this Atendimento's own
  // persisted periodic decision (if any) is authoritative and overrides
  // the live store policy for it — checklistObrigatorio === true always
  // blocks deferral (a sampled/guardrail-selected Atendimento behaves like
  // required), checklistObrigatorio === false always allows it regardless
  // of what the live policy says now. Only when no per-Atendimento
  // decision exists (checklistObrigatorio === null) does the live
  // checklistPolicy decide, exactly as in 2C.1/2C.2.
  // Milestone 2D: Farei depois is never available during previous-day
  // recovery (section 14), regardless of any historical checklist_obrigatorio
  // value — see the migration comment on concluir_atendimento_pendente for
  // the full reasoning on why this does not conflict with a previously-
  // persisted non-mandatory periodic decision.
  const podeAdiar =
    !isPendingRecovery &&
    (checklistObrigatorio === false ||
      (checklistObrigatorio === null && checklistPolicy === "defer_allowed")) &&
    clientesValidos;
  // Milestone 2C.3 QA fix: derived once and reused for both the copy below
  // and (potentially) future callers, instead of repeating the `=== true`
  // comparison inline — the strict comparison itself was already correct
  // (checklistObrigatorio is only ever true/false/null), the actual QA
  // finding was that the swapped-in text used the exact same
  // text-muted-foreground weight/color as the routine subtitle it replaces,
  // making it easy to miss at a glance since it was the only signal that
  // this closing behaves differently. Styling only — no icon, no
  // warning/destructive color, so it stays neutral/non-alarming per spec.
  const checklistObrigatorioPeriodico = checklistObrigatorio === true;

  const handleVoltarClick = () => {
    if (draft.isDirty) {
      setConfirmVoltarOpen(true);
    } else {
      onVoltar();
    }
  };

  const clientesPayload = () =>
    draft.clientes.map((c) => ({
      id_motivo: c.idMotivo as string,
      detalhe: c.detalhe.trim() || null,
    }));

  const handleSubmit = () => {
    if (!formValido || submitting) return;
    onConcluir(
      clientesPayload(),
      checklistItens.map((item) => ({
        codigo: item.codigo,
        concluido: draft.checklist[item.codigo] === true,
      })),
    );
  };

  const handleFareiDepois = () => {
    if (!podeAdiar || submitting) return;
    onFareiDepois(clientesPayload());
  };

  return (
    <Card className="flex flex-col gap-4 p-6 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          {isPendingRecovery ? ATENDIMENTO_PENDENTE_TITLE : FECHAMENTO_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isPendingRecovery ? ATENDIMENTO_PENDENTE_SUBTITLE : FECHAMENTO_SUBTITLE}
        </p>
        {isPendingRecovery && diaOriginalFormatado && (
          <p className="text-xs text-muted-foreground">
            {getAtendimentoPendenteDataLabel(diaOriginalFormatado)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {draft.clientes.map((cliente, index) => (
          <ClienteCard
            key={cliente.localId}
            index={index}
            cliente={cliente}
            motivos={motivos}
            motivosLoading={motivosLoading}
            podeRemover={draft.clientes.length > 1}
            onAtualizar={(patch) => draft.atualizar(cliente.localId, patch)}
            onRemover={() => draft.remover(cliente.localId)}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="min-touch w-full gap-2"
        onClick={draft.adicionar}
      >
        <Plus className="h-4 w-4" aria-hidden />
        {ADICIONAR_CLIENTE_LABEL}
      </Button>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-foreground">{CHECKLIST_TITLE}</h3>
          <p
            className={
              checklistObrigatorioPeriodico
                ? "text-sm font-medium text-foreground"
                : "text-sm text-muted-foreground"
            }
          >
            {checklistObrigatorioPeriodico
              ? CHECKLIST_OBRIGATORIO_PERIODICO_MESSAGE
              : CHECKLIST_SUBTITLE}
          </p>
        </div>
        {checklistLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {CHECKLIST_LOADING_MESSAGE}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {checklistItens.map((item) => (
              <ChecklistItemRow
                key={item.id}
                item={item}
                concluido={draft.checklist[item.codigo] === true}
                onToggle={() => draft.alternarItemChecklist(item.codigo)}
              />
            ))}
          </div>
        )}
      </div>

      {errorMessage && (
        <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          className="min-touch w-full"
          disabled={!formValido || submitting}
          onClick={handleSubmit}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            FECHAMENTO_SUBMIT_LABEL
          )}
        </Button>
        {podeAdiar && (
          // Deliberately secondary — completing the checklist now remains
          // the preferred/default path (section 8). Amber-toned rather than
          // destructive-red: deferring isn't undoing anything, it just
          // creates pending work, so it shouldn't read as a warning/error
          // action.
          <div className="flex flex-col items-center gap-1">
            <Button
              type="button"
              variant="outline"
              className="min-touch w-full border-warning/40 text-warning hover:bg-warning/10"
              disabled={submitting}
              onClick={handleFareiDepois}
            >
              {FAREI_DEPOIS_LABEL}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{FAREI_DEPOIS_SUPPORT_TEXT}</p>
          </div>
        )}
        {!isPendingRecovery && (
          <Button
            type="button"
            variant="ghost"
            className="min-touch w-full"
            disabled={submitting}
            onClick={handleVoltarClick}
          >
            {VOLTAR_AO_ATENDIMENTO_LABEL}
          </Button>
        )}
      </div>

      {!isPendingRecovery && (
        <UnsavedDataConfirmDialog
          open={confirmVoltarOpen}
          onOpenChange={setConfirmVoltarOpen}
          onConfirmDiscard={() => {
            setConfirmVoltarOpen(false);
            onVoltar();
          }}
        />
      )}
    </Card>
  );
}
