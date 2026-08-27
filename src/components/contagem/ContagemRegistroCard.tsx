import { ChevronRight } from "lucide-react";

import { ContagemStatusBadge } from "@/components/contagem/ContagemStatusBadge";
import {
  CONTAGEM_ABRIR_DETALHE_LABEL,
  CONTAGEM_PREENCHIDO_POR_PREFIX,
  CONTAGEM_REVISADO_POR_PREFIX,
  getContagemItensContadosLabel,
} from "@/config/constants";
import type { ContagemStatus } from "@/integrations/supabase/contracts";
import { formatContagemDataHora } from "@/lib/contagem";

interface ContagemRegistroCardProps {
  status: ContagemStatus;
  submetidoEm: string;
  submetidoPorNome: string;
  revisadoPorNome?: string | null;
  totalItens: number;
  onClick: () => void;
}

/** One row in the Pendentes / Histórico lists — tap to open the detail. */
export function ContagemRegistroCard({
  status,
  submetidoEm,
  submetidoPorNome,
  revisadoPorNome,
  totalItens,
  onClick,
}: ContagemRegistroCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={CONTAGEM_ABRIR_DETALHE_LABEL}
      className="min-touch flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40 active:bg-accent/60"
    >
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-foreground">
          {formatContagemDataHora(submetidoEm)}
        </span>
        <span className="text-xs text-muted-foreground">
          {CONTAGEM_PREENCHIDO_POR_PREFIX} {submetidoPorNome}
        </span>
        {revisadoPorNome && (
          <span className="text-xs text-muted-foreground">
            {CONTAGEM_REVISADO_POR_PREFIX} {revisadoPorNome}
          </span>
        )}
        <span className="mt-1 text-xs text-muted-foreground">
          {getContagemItensContadosLabel(totalItens)}
        </span>
        <span className="mt-1.5">
          <ContagemStatusBadge status={status} />
        </span>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}
