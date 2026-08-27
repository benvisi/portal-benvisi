import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ESCALA_CARREGANDO_MESSAGE,
  ESCALA_ERRO_MESSAGE,
  ESCALA_MES_ANTERIOR_LABEL,
  ESCALA_MES_NAO_DISPONIVEL_MESSAGE,
  ESCALA_PROXIMO_MES_LABEL,
  ESCALA_SECAO_LABELS,
  MINHA_ESCALA_TITLE,
} from "@/config/constants";
import { ESCALA_SECAO_PALETTE } from "@/config/escala-sections";
import { useEscalaMesesPublicados } from "@/hooks/useEscalaMesesPublicados";
import { useMinhaEscalaMes } from "@/hooks/useMinhaEscalaMes";
import {
  addMonthsISO,
  formatEscalaDiaCompacto,
  formatHora,
  formatMesAno,
  isSecaoComHorario,
  monthStartISO,
} from "@/lib/escala";

interface EscalaMesViewProps {
  sessionToken: string | null;
  mesSelecionado: string;
  onMesSelecionadoChange: (mes: string) => void;
  /** Navigate to the "Dia" tab focused on the given calendar date. */
  onDiaSelecionado: (data: string) => void;
}

export function EscalaMesView({
  sessionToken,
  mesSelecionado,
  onMesSelecionadoChange,
  onDiaSelecionado,
}: EscalaMesViewProps) {
  const query = useMinhaEscalaMes(sessionToken, mesSelecionado);
  const mesesPublicadosQuery = useEscalaMesesPublicados(sessionToken);

  const proximoMes = addMonthsISO(mesSelecionado, 1);
  const mesesPublicados = new Set((mesesPublicadosQuery.data ?? []).map((m) => m.mes_referencia));
  // "Previous/current month always accessible; a future month only if
  // explicitly published" (section 18) — enforced here for the one control
  // that jumps a whole month forward. Hoje/Semana's day-by-day navigation
  // has no equivalent hard gate: stepping past the published range just
  // degrades gracefully to "A confirmar" rows, never a dead end.
  const proximoMesDisponivel = mesesPublicados.has(monthStartISO(proximoMes));
  // get_minha_escala_mes always returns one row per calendar day (never an
  // empty array) — an unpublished month would otherwise render as 28-31
  // identical "A confirmar" rows. Showing one clear message instead
  // satisfies "explain clearly if no schedule is currently published"
  // (section 20) better than that repetition would.
  const mesPublicado = mesesPublicados.has(monthStartISO(mesSelecionado));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={ESCALA_MES_ANTERIOR_LABEL}
          onClick={() => onMesSelecionadoChange(addMonthsISO(mesSelecionado, -1))}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className="text-sm font-semibold text-foreground">
          {formatMesAno(mesSelecionado)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch shrink-0"
          aria-label={ESCALA_PROXIMO_MES_LABEL}
          disabled={!proximoMesDisponivel}
          onClick={() => onMesSelecionadoChange(proximoMes)}
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {MINHA_ESCALA_TITLE}
      </p>

      {query.isLoading || mesesPublicadosQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {ESCALA_CARREGANDO_MESSAGE}
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{ESCALA_ERRO_MESSAGE}</p>
      ) : !mesPublicado ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {ESCALA_MES_NAO_DISPONIVEL_MESSAGE}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(query.data ?? []).map((entrada) => {
            const pal = ESCALA_SECAO_PALETTE[entrada.secao];
            const mostrarHora = Boolean(
              isSecaoComHorario(entrada.secao) && entrada.hora_inicio && entrada.hora_fim,
            );
            return (
              <li key={entrada.data}>
                <button
                  type="button"
                  onClick={() => onDiaSelecionado(entrada.data)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left shadow-card transition-colors hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ backgroundColor: pal.bg, borderColor: pal.border }}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {formatEscalaDiaCompacto(entrada.data)}
                    </span>
                    {entrada.feriado_nome && (
                      <span className="text-xs text-brand">{entrada.feriado_nome}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-medium" style={{ color: pal.text }}>
                    {mostrarHora
                      ? `${formatHora(entrada.hora_inicio)}–${formatHora(entrada.hora_fim)}`
                      : ESCALA_SECAO_LABELS[entrada.secao]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
