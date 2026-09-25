import { Badge } from "@/components/ui/badge";
import {
  OUTCOME_CONVERTIDO_LABEL,
  OUTCOME_NAO_CONVERTIDO_LABEL,
  getAtendimentoResumoHojeResultadosLabel,
} from "@/config/constants";
import { formatAtendimentoResumoHora } from "@/lib/atendimentoResumoHoje";
import type { AtendimentoResumoItem, AtendimentoResumoOutcome } from "@/lib/atendimentoResumoHoje";
import { cn } from "@/lib/utils";

interface AtendimentoResumoAtendimentoRowProps {
  item: AtendimentoResumoItem;
  /** Shown alongside the start time only in the "Por atendimento" view — the
   * "Por vendedor" view already groups these rows under the vendedor's own
   * name, so repeating it there would be redundant. */
  funcionarioNome?: string;
}

/**
 * Same restrained semantic tints as ClienteCard's read-only state (light
 * fill, not a punitive full-saturation destructive badge for "Não
 * convertido" — conversion outcome is a customer/context fact, not an
 * employee failure signal, per Blueprint section 8.15.2).
 */
function OutcomeBadge({ categoria }: { categoria: AtendimentoResumoOutcome["categoria"] }) {
  const convertido = categoria === "convertido";
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-medium",
        convertido
          ? "border-success/30 bg-success/10 text-foreground"
          : "border-destructive/20 bg-destructive/5 text-foreground",
      )}
    >
      {convertido ? OUTCOME_CONVERTIDO_LABEL : OUTCOME_NAO_CONVERTIDO_LABEL}
    </Badge>
  );
}

/**
 * One concluded atendimento, rendered as one entry regardless of how many
 * atendimento_clientes outcome rows it carries (Card #36: "keep it visually
 * as one atendimento, not duplicate atendimento entries"). The "N
 * resultados · N convertidos" summary only appears once there is more than
 * one outcome.
 */
export function AtendimentoResumoAtendimentoRow({
  item,
  funcionarioNome,
}: AtendimentoResumoAtendimentoRowProps) {
  const hora = formatAtendimentoResumoHora(item.iniciadoEm);
  const temMultiplosResultados = item.outcomes.length > 1;
  const convertidos = item.outcomes.filter((outcome) => outcome.categoria === "convertido").length;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
      <span className="text-sm font-medium text-foreground">
        {funcionarioNome ? `${funcionarioNome} · ${hora}` : hora}
      </span>

      {temMultiplosResultados && (
        <span className="text-xs font-medium text-muted-foreground">
          {getAtendimentoResumoHojeResultadosLabel(item.outcomes.length, convertidos)}
        </span>
      )}

      <ul className="flex flex-col gap-1.5">
        {item.outcomes.map((outcome) => (
          <li key={outcome.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <OutcomeBadge categoria={outcome.categoria} />
              <span className="text-sm text-foreground">{outcome.motivoRotulo}</span>
            </div>
            {outcome.detalhe && <p className="text-xs text-muted-foreground">{outcome.detalhe}</p>}
          </li>
        ))}
      </ul>
    </li>
  );
}
