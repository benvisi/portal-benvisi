import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { ChecklistItemRow } from "@/components/atendimento/ChecklistItemRow";
import { ClienteCard } from "@/components/atendimento/ClienteCard";
import { UnsavedDataConfirmDialog } from "@/components/atendimento/UnsavedDataConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ADICIONAR_CLIENTE_LABEL,
  CHECKLIST_LOADING_MESSAGE,
  CHECKLIST_SUBTITLE,
  CHECKLIST_TITLE,
  FAREI_DEPOIS_LABEL,
  FAREI_DEPOIS_SUPPORT_TEXT,
  FECHAMENTO_SUBMIT_LABEL,
  FECHAMENTO_SUBTITLE,
  FECHAMENTO_TITLE,
  VOLTAR_AO_ATENDIMENTO_LABEL,
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
  // Milestone 2C.1: Farei depois is only ever offered under defer_allowed
  // (section 7/8) — never inferred from an incomplete checklist, always an
  // explicit separate action. Still requires valid customer data, exactly
  // like the normal submit path (section 10: customer outcomes are still
  // validated and persisted on the deferral path).
  const podeAdiar = checklistPolicy === "defer_allowed" && clientesValidos;

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
        <h2 className="text-lg font-semibold text-foreground">{FECHAMENTO_TITLE}</h2>
        <p className="text-sm text-muted-foreground">{FECHAMENTO_SUBTITLE}</p>
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
          <p className="text-sm text-muted-foreground">{CHECKLIST_SUBTITLE}</p>
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
        <Button
          type="button"
          variant="ghost"
          className="min-touch w-full"
          disabled={submitting}
          onClick={handleVoltarClick}
        >
          {VOLTAR_AO_ATENDIMENTO_LABEL}
        </Button>
      </div>

      <UnsavedDataConfirmDialog
        open={confirmVoltarOpen}
        onOpenChange={setConfirmVoltarOpen}
        onConfirmDiscard={() => {
          setConfirmVoltarOpen(false);
          onVoltar();
        }}
      />
    </Card>
  );
}
