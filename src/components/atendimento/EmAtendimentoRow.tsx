import { Loader2, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FECHAMENTO_STATUS_LABEL,
  LISTA_DA_VEZ_VOCE_LABEL,
  getConcluirGerencialAriaLabel,
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
  // Conclusão gerencial (required behavior 1/6): true only for a
  // Gerente/Administrador viewing another employee's row while it is
  // 'finalizando' — never on the viewer's own row (souEu already covers
  // their own normal completion flow via FechamentoAtendimento). Enforced
  // server-side too (concluir_atendimento_gerencial re-checks cargo) — this
  // prop only controls whether the button renders.
  podeConcluirComoGerente: boolean;
  onConcluirComoGerente: (idAtendimento: string, nome: string) => void;
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
  podeConcluirComoGerente,
  onConcluirComoGerente,
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
  const mostrarConcluirGerencial =
    podeConcluirComoGerente && status === "finalizando" && idAtendimento !== null;

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
      {mostrarConcluirGerencial && idAtendimento && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-touch shrink-0 whitespace-nowrap"
          onClick={() => onConcluirComoGerente(idAtendimento, nome)}
          aria-label={getConcluirGerencialAriaLabel(nome)}
        >
          <UserCheck className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {souEu && <Badge variant="outline">{LISTA_DA_VEZ_VOCE_LABEL}</Badge>}
    </li>
  );
}
