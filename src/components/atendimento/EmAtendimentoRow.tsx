import { Badge } from "@/components/ui/badge";
import { FECHAMENTO_STATUS_LABEL, LISTA_DA_VEZ_VOCE_LABEL } from "@/config/constants";
import { useElapsedMinutes } from "@/hooks/useElapsedMinutes";

interface EmAtendimentoRowProps {
  nome: string;
  status: "em_atendimento" | "finalizando";
  iniciadoEm: string | null;
  souEu: boolean;
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
 */
export function EmAtendimentoRow({ nome, status, iniciadoEm, souEu }: EmAtendimentoRowProps) {
  const minutos = useElapsedMinutes(status === "em_atendimento" ? iniciadoEm : null);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
      <span className="text-sm font-medium text-muted-foreground">{nome}</span>
      <span className="ml-auto text-xs font-semibold text-warning">
        {status === "finalizando"
          ? FECHAMENTO_STATUS_LABEL
          : minutos !== null
            ? formatElapsedMinutes(minutos)
            : "—"}
      </span>
      {souEu && <Badge variant="outline">{LISTA_DA_VEZ_VOCE_LABEL}</Badge>}
    </li>
  );
}
