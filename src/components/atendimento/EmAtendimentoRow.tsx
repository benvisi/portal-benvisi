import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FECHAMENTO_STATUS_LABEL,
  LISTA_DA_VEZ_VOCE_LABEL,
  getUndoButtonLabel,
} from "@/config/constants";
import { useCountdown } from "@/hooks/useCountdown";
import { useElapsedMinutes } from "@/hooks/useElapsedMinutes";

interface EmAtendimentoRowProps {
  nome: string;
  status: "em_atendimento" | "finalizando";
  iniciadoEm: string | null;
  souEu: boolean;
  idAtendimento: string | null;
  prazoProvisorioEm: string | null;
  podeCancelarComoIniciador: boolean;
  cancelando: boolean;
  onCancelarInicio: (idAtendimento: string) => void;
}

function formatElapsedMinutes(minutos: number): string {
  return minutos < 1 ? "< 1 min" : `${minutos} min`;
}

/**
 * One row per employee currently Em atendimento or Finalizando. The
 * warning-tinted row treatment already signals "busy" at a glance, so the
 * status/elapsed-time display replaces the old "Em atendimento" pill rather
 * than sitting alongside it. For a Finalizando employee, iniciado_em is
 * already null from the server (get_lista_vez_estado only populates it for
 * em_atendimento), so there is no ticking timer to show even before this
 * component's own status check — this is a defense-in-depth double
 * guarantee that other employees never see an increasing timer once
 * someone enters closing.
 *
 * podeCancelarComoIniciador (Milestone 2A.1, section 5): true only when the
 * current viewer delegated this specific Atendimento's start for someone
 * else — never for the responsible employee's own row (they already have
 * the normal Cancelar início on their own active card) and never once the
 * accidental-start grace period has passed, which this component enforces
 * locally via useCountdown against the server-authoritative
 * prazoProvisorioEm. This is a UX convenience only: cancelar_atendimento_provisorio
 * independently re-validates both permission and the deadline server-side
 * regardless of what this component shows or hides.
 */
export function EmAtendimentoRow({
  nome,
  status,
  iniciadoEm,
  souEu,
  idAtendimento,
  prazoProvisorioEm,
  podeCancelarComoIniciador,
  cancelando,
  onCancelarInicio,
}: EmAtendimentoRowProps) {
  const minutos = useElapsedMinutes(status === "em_atendimento" ? iniciadoEm : null);
  const { secondsLeft, isExpired } = useCountdown(
    podeCancelarComoIniciador ? prazoProvisorioEm : null,
  );
  const mostrarDesfazer =
    podeCancelarComoIniciador &&
    !isExpired &&
    idAtendimento !== null &&
    status === "em_atendimento";

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
      <span className="text-sm font-medium text-muted-foreground">{nome}</span>
      <span className="ml-auto text-xs font-semibold text-warning">
        {status === "finalizando"
          ? FECHAMENTO_STATUS_LABEL
          : minutos !== null
            ? formatElapsedMinutes(minutos)
            : "—"}
      </span>
      {mostrarDesfazer && idAtendimento && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-touch shrink-0 whitespace-nowrap border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={cancelando}
          onClick={() => onCancelarInicio(idAtendimento)}
        >
          {cancelando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            getUndoButtonLabel(secondsLeft)
          )}
        </Button>
      )}
      {souEu && <Badge variant="outline">{LISTA_DA_VEZ_VOCE_LABEL}</Badge>}
    </li>
  );
}
