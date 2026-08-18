import { Badge } from "@/components/ui/badge";
import { LISTA_DA_VEZ_VOCE_LABEL } from "@/config/constants";
import { useElapsedMinutes } from "@/hooks/useElapsedMinutes";

interface EmAtendimentoRowProps {
  nome: string;
  iniciadoEm: string | null;
  souEu: boolean;
}

function formatElapsedMinutes(minutos: number): string {
  return minutos < 1 ? "< 1 min" : `${minutos} min`;
}

/**
 * One row per employee currently Em atendimento. The warning-tinted row
 * treatment already signals "busy" at a glance, so the elapsed-time display
 * replaces the old "Em atendimento" pill rather than sitting alongside it.
 */
export function EmAtendimentoRow({ nome, iniciadoEm, souEu }: EmAtendimentoRowProps) {
  const minutos = useElapsedMinutes(iniciadoEm);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
      <span className="text-sm font-medium text-muted-foreground">{nome}</span>
      <span className="ml-auto text-xs font-semibold text-warning">
        {minutos !== null ? formatElapsedMinutes(minutos) : "—"}
      </span>
      {souEu && <Badge variant="outline">{LISTA_DA_VEZ_VOCE_LABEL}</Badge>}
    </li>
  );
}
