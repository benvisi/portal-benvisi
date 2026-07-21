import { Construction } from "lucide-react";

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
  MODULE_IN_PROGRESS_ACK_LABEL,
  MODULE_IN_PROGRESS_DESCRIPTION,
  MODULE_IN_PROGRESS_TITLE,
} from "@/config/constants";

interface ModuleInProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shared placeholder dialog for every unfinished dashboard module
 * (Atendimento, Estoque, Operações, Administrativo). One instance is
 * rendered per dashboard and reused across all module cards.
 */
export function ModuleInProgressDialog({ open, onOpenChange }: ModuleInProgressDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Construction className="h-6 w-6" aria-hidden />
          </span>
          <DialogTitle>{MODULE_IN_PROGRESS_TITLE}</DialogTitle>
          <DialogDescription>{MODULE_IN_PROGRESS_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button
            type="button"
            className="min-touch w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            {MODULE_IN_PROGRESS_ACK_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
