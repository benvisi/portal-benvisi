import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { ClienteCard } from "@/components/atendimento/ClienteCard";
import { UnsavedDataConfirmDialog } from "@/components/atendimento/UnsavedDataConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ADICIONAR_CLIENTE_LABEL,
  FECHAMENTO_SUBMIT_LABEL,
  FECHAMENTO_SUBTITLE,
  FECHAMENTO_TITLE,
  VOLTAR_AO_ATENDIMENTO_LABEL,
} from "@/config/constants";
import type { AtendimentoMotivo } from "@/integrations/supabase/contracts";
import type { ClienteRascunho, FechamentoDraft } from "@/hooks/useFechamentoDraft";
import type { ClienteOutcomeInput } from "@/hooks/useAtendimentoActions";

interface FechamentoAtendimentoProps {
  draft: FechamentoDraft;
  motivos: AtendimentoMotivo[];
  motivosLoading: boolean;
  submitting: boolean;
  errorMessage: string | null;
  onVoltar: () => void;
  onConcluir: (clientes: ClienteOutcomeInput[]) => void;
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
  submitting,
  errorMessage,
  onVoltar,
  onConcluir,
}: FechamentoAtendimentoProps) {
  const [confirmVoltarOpen, setConfirmVoltarOpen] = useState(false);

  const formValido = draft.clientes.every((c) => isClienteCompleto(c, motivos));

  const handleVoltarClick = () => {
    if (draft.isDirty) {
      setConfirmVoltarOpen(true);
    } else {
      onVoltar();
    }
  };

  const handleSubmit = () => {
    if (!formValido || submitting) return;
    onConcluir(
      draft.clientes.map((c) => ({
        id_motivo: c.idMotivo as string,
        detalhe: c.detalhe.trim() || null,
      })),
    );
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
