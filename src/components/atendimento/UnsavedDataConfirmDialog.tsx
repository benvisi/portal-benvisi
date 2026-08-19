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
import {
  FECHAMENTO_UNSAVED_CONFIRM_ACCEPT_LABEL,
  FECHAMENTO_UNSAVED_CONFIRM_CANCEL_LABEL,
  FECHAMENTO_UNSAVED_CONFIRM_DESCRIPTION,
  FECHAMENTO_UNSAVED_CONFIRM_TITLE,
} from "@/config/constants";

interface UnsavedDataConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDiscard: () => void;
}

/**
 * Shared by the Voltar ao atendimento and Voltar ao painel unsaved-data
 * guards. AlertDialogCancel stays mapped to "Continuar preenchendo" (so
 * Escape/overlay-dismiss safely keeps the employee in the form, matching
 * Radix's built-in Cancel semantics) and AlertDialogAction stays mapped to
 * "Sair sem salvar" (the explicit discard action) — only their visual
 * treatment is swapped from Radix's defaults: the safe choice gets the
 * prominent primary styling, the destructive choice gets a restrained
 * outlined/destructive-text treatment so it doesn't visually invite an
 * accidental tap.
 */
export function UnsavedDataConfirmDialog({
  open,
  onOpenChange,
  onConfirmDiscard,
}: UnsavedDataConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{FECHAMENTO_UNSAVED_CONFIRM_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>{FECHAMENTO_UNSAVED_CONFIRM_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-0 bg-primary text-primary-foreground shadow hover:bg-primary/90">
            {FECHAMENTO_UNSAVED_CONFIRM_CANCEL_LABEL}
          </AlertDialogCancel>
          <AlertDialogAction
            className="border border-destructive/40 bg-transparent text-destructive shadow-none hover:bg-destructive/10"
            onClick={onConfirmDiscard}
          >
            {FECHAMENTO_UNSAVED_CONFIRM_ACCEPT_LABEL}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
