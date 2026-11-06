import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  IMAGENS_PRODUTO_CANCELAR_LABEL,
  IMAGENS_PRODUTO_REJEITAR_CONFIRMAR_LABEL,
  IMAGENS_PRODUTO_REJEITAR_CONFIRMAR_TITLE,
  IMAGENS_PRODUTO_REJEITAR_MOTIVO_LABEL,
} from "@/config/constants";

interface DialogoBase {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Rejection confirmation; rejeitar_candidato_imagem requires a non-empty reason. */
export function ConfirmarRejeicaoDialog({
  open,
  busy,
  onOpenChange,
  onConfirmar,
}: DialogoBase & { onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState("");

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{IMAGENS_PRODUTO_REJEITAR_CONFIRMAR_TITLE}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <label htmlFor="imagens-produto-motivo" className="text-sm text-foreground">
                {IMAGENS_PRODUTO_REJEITAR_MOTIVO_LABEL}
              </label>
              <Textarea
                id="imagens-produto-motivo"
                value={motivo}
                disabled={busy}
                maxLength={500}
                onChange={(event) => setMotivo(event.target.value)}
                className="mt-2"
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="min-touch"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {IMAGENS_PRODUTO_CANCELAR_LABEL}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-touch"
            disabled={busy || motivo.trim().length === 0}
            onClick={() => onConfirmar(motivo)}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {IMAGENS_PRODUTO_REJEITAR_CONFIRMAR_LABEL}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
