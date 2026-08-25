import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ChecklistItemRow } from "@/components/atendimento/ChecklistItemRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CHECKLIST_AVULSO_SUBMIT_LABEL,
  CHECKLIST_AVULSO_SUBTITLE,
  CHECKLIST_AVULSO_TITLE,
  CHECKLIST_LOADING_MESSAGE,
  SEM_CHECKLIST_PENDENTE_MESSAGE,
  getChecklistAvulsoSuccessMessage,
} from "@/config/constants";
import { useAtendimentoChecklist } from "@/hooks/useAtendimentoChecklist";
import { useConcluirChecklistAvulso } from "@/hooks/useConcluirChecklistAvulso";

interface StandaloneChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  funcionarioId: string | null;
  sessionToken: string | null;
}

/**
 * Milestone 2C.2, section 7: a lightweight standalone checklist experience
 * — same item/guidance treatment as the Atendimento closing checklist
 * (ChecklistItemRow, reused as-is), no customer/outcome/motive questions,
 * no Atendimento created. Draft state (`checked`) is local-only and resets
 * whenever the dialog closes, same "not persisted anywhere" convention as
 * useFechamentoDraft.
 */
export function StandaloneChecklistDialog({
  open,
  onOpenChange,
  funcionarioId,
  sessionToken,
}: StandaloneChecklistDialogProps) {
  const checklistQuery = useAtendimentoChecklist(sessionToken);
  const { submitting, errorMessage, concluir } = useConcluirChecklistAvulso(
    funcionarioId,
    sessionToken,
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const items = checklistQuery.data ?? [];
  const allChecked = items.length > 0 && items.every((item) => checked[item.codigo] === true);

  const handleOpenChange = (next: boolean) => {
    if (!next) setChecked({});
    onOpenChange(next);
  };

  const handleToggle = (codigo: string) => {
    setChecked((prev) => ({ ...prev, [codigo]: !prev[codigo] }));
  };

  const handleSubmit = async () => {
    if (!allChecked || submitting) return;

    const result = await concluir(
      items.map((item) => ({ codigo: item.codigo, concluido: checked[item.codigo] === true })),
    );

    if (result.status === "ok") {
      toast(getChecklistAvulsoSuccessMessage(result.resolvedCount));
      handleOpenChange(false);
    } else if (result.status === "no_pending") {
      // Another device already resolved the backlog — not a failure from
      // this employee's point of view, just stale UI catching up.
      toast(SEM_CHECKLIST_PENDENTE_MESSAGE);
      handleOpenChange(false);
    }
    // "error": errorMessage is already set below and the dialog stays open.
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{CHECKLIST_AVULSO_TITLE}</DialogTitle>
          <DialogDescription>{CHECKLIST_AVULSO_SUBTITLE}</DialogDescription>
        </DialogHeader>

        {checklistQuery.isLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {CHECKLIST_LOADING_MESSAGE}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <ChecklistItemRow
                key={item.id}
                item={item}
                concluido={checked[item.codigo] === true}
                onToggle={() => handleToggle(item.codigo)}
              />
            ))}
          </div>
        )}

        {errorMessage && (
          <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
            {errorMessage}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            className="min-touch w-full"
            disabled={!allChecked || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              CHECKLIST_AVULSO_SUBMIT_LABEL
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
