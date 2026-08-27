import { Badge } from "@/components/ui/badge";
import { CONTAGEM_STATUS_PENDENTE_LABEL, CONTAGEM_STATUS_REVISADA_LABEL } from "@/config/constants";
import type { ContagemStatus } from "@/integrations/supabase/contracts";

/**
 * Small status pill for the review cards and the detail header.
 *
 * "Pendente de revisão" uses the same lightweight amber attention treatment
 * already established across Portal (Lista da Vez "fora" card,
 * PendingChecklistIndicator, EmAtendimentoRow): border-warning/40 +
 * bg-warning/15 + text-warning — it draws the eye without reading as an
 * error. "Revisada" stays calmer and clearly distinct on the neutral
 * secondary treatment.
 */
export function ContagemStatusBadge({ status }: { status: ContagemStatus }) {
  if (status === "revisada") {
    return (
      <Badge variant="secondary" className="shrink-0">
        {CONTAGEM_STATUS_REVISADA_LABEL}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/15 text-warning">
      {CONTAGEM_STATUS_PENDENTE_LABEL}
    </Badge>
  );
}
