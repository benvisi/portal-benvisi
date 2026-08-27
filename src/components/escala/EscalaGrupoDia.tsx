import {
  ESCALA_A_CONFIRMAR_SUPPORT_TEXT,
  ESCALA_SECAO_LABELS,
  ESCALA_VOCE_LABEL,
} from "@/config/constants";
import { ESCALA_SECAO_PALETTE } from "@/config/escala-sections";
import type { EscalaEntradaPeriodo } from "@/integrations/supabase/contracts";
import {
  agruparEntradasPorSecao,
  ESCALA_SECAO_ORDEM,
  formatHora,
  isSecaoComHorario,
} from "@/lib/escala";
import { cn } from "@/lib/utils";

interface EscalaGrupoDiaProps {
  entradas: readonly EscalaEntradaPeriodo[];
  funcionarioLogadoId: string | null;
  /** Semana's day cards render a lighter version: no "A confirmar" support copy. */
  compact?: boolean;
}

/**
 * Renders one day's team schedule grouped by section, in the approved
 * display order (Milestone 4C.2). Only sections that actually have members
 * are shown; each section is a colour-bounded block (see ESCALA_SECAO_PALETTE)
 * and, when every working member shares the same start/end, that one window
 * is shown once in the section heading rather than repeated on every row.
 * Gerência employees appear here in their normal section with their hours
 * withheld (the RPC returns them null), so their row is name-only.
 */
export function EscalaGrupoDia({
  entradas,
  funcionarioLogadoId,
  compact = false,
}: EscalaGrupoDiaProps) {
  const grupos = agruparEntradasPorSecao(entradas);
  const secoesComConteudo = ESCALA_SECAO_ORDEM.filter(
    (secao) => (grupos.get(secao)?.length ?? 0) > 0,
  );

  if (secoesComConteudo.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {secoesComConteudo.map((secao) => {
        const membros = grupos.get(secao) ?? [];
        const pal = ESCALA_SECAO_PALETTE[secao];
        const comHorario = isSecaoComHorario(secao);

        // One shared window shown in the heading when every member that has
        // hours shares the same one. Members with withheld hours (gerência)
        // are ignored for this check — they simply never contribute a time,
        // in the heading or on their row. Only genuinely differing windows
        // fall back to per-row times.
        const janelas = comHorario
          ? membros
              .filter((m) => m.hora_inicio && m.hora_fim)
              .map((m) => `${formatHora(m.hora_inicio)}–${formatHora(m.hora_fim)}`)
          : [];
        const janelaCompartilhada =
          comHorario && janelas.length > 0 && janelas.every((j) => j === janelas[0])
            ? janelas[0]
            : null;

        return (
          <div
            key={secao}
            className={cn("flex flex-col gap-1.5 rounded-xl border", compact ? "p-2.5" : "p-3")}
            style={{ backgroundColor: pal.bg, borderColor: pal.border }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: pal.text }}
            >
              {ESCALA_SECAO_LABELS[secao]}
              {janelaCompartilhada && (
                <span className="font-medium normal-case tracking-normal">
                  {" · "}
                  {janelaCompartilhada}
                </span>
              )}
            </span>
            <ul className="flex flex-col gap-1">
              {membros.map((membro) => {
                const isVoce = membro.id_funcionario === funcionarioLogadoId;
                const mostrarHora = Boolean(
                  comHorario && !janelaCompartilhada && membro.hora_inicio && membro.hora_fim,
                );
                return (
                  <li
                    key={membro.id_funcionario}
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm",
                      isVoce
                        ? "border border-primary/50 bg-primary/5 font-medium text-foreground"
                        : "text-foreground",
                    )}
                    style={isVoce ? undefined : { backgroundColor: pal.bgRow }}
                  >
                    <span className="flex items-baseline gap-1.5">
                      {membro.apelido}
                      {isVoce && (
                        <span className="text-xs font-normal text-primary">
                          ({ESCALA_VOCE_LABEL})
                        </span>
                      )}
                    </span>
                    {mostrarHora && (
                      <span className="shrink-0 text-muted-foreground">
                        {formatHora(membro.hora_inicio)}
                        {"–"}
                        {formatHora(membro.hora_fim)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {secao === "a_confirmar" && !compact && (
              <p className="text-xs" style={{ color: pal.text }}>
                {ESCALA_A_CONFIRMAR_SUPPORT_TEXT}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
