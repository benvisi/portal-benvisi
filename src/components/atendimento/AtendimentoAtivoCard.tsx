import { Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ATENDIMENTO_ATIVO_LABEL,
  ATENDIMENTO_CANCEL_PROVISORIO_BUTTON_LABEL,
  ATENDIMENTO_COMPLETE_BUTTON_LABEL,
  ATENDIMENTO_PROVISORIO_DESCRIPTION,
  ATENDIMENTO_PROVISORIO_LABEL,
  FORA_DE_ORDEM_BADGE_LABEL,
} from "@/config/constants";
import { useCountdown } from "@/hooks/useCountdown";

interface AtendimentoAtivoCardProps {
  foraDeOrdem: boolean;
  prazoProvisorioEm: string;
  submitting: boolean;
  errorMessage: string | null;
  onCancelarProvisorio: () => void;
  onIniciarFechamento: () => void;
}

export function AtendimentoAtivoCard({
  foraDeOrdem,
  prazoProvisorioEm,
  submitting,
  errorMessage,
  onCancelarProvisorio,
  onIniciarFechamento,
}: AtendimentoAtivoCardProps) {
  const { secondsLeft, isExpired } = useCountdown(prazoProvisorioEm);
  const isProvisional = !isExpired;

  return (
    <Card className="flex flex-col gap-4 bg-brand p-6 text-brand-foreground shadow-card">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-foreground/15">
          <Users className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-lg font-semibold">
            {isProvisional ? ATENDIMENTO_PROVISORIO_LABEL : ATENDIMENTO_ATIVO_LABEL}
          </span>
          {/*
            Elapsed duration once official is shown on this employee's own
            Lista da Vez row below (EmAtendimentoRow) instead of duplicated
            here.
          */}
          {isProvisional && (
            <span className="text-sm text-brand-foreground/80">
              {ATENDIMENTO_PROVISORIO_DESCRIPTION} ({secondsLeft}s)
            </span>
          )}
        </div>
      </div>

      {foraDeOrdem && (
        <Badge variant="outline" className="w-fit border-brand-foreground/30 text-brand-foreground">
          {FORA_DE_ORDEM_BADGE_LABEL}
        </Badge>
      )}

      {errorMessage && (
        <p role="alert" aria-live="polite" className="text-sm font-medium text-brand-foreground">
          {errorMessage}
        </p>
      )}

      {/*
        The 20-second window is an accidental-start cancellation window, not
        a minimum Atendimento duration — a legitimate Atendimento may enter
        closing at any point, including during these first 20 seconds.
        Cancelar início is additionally available (and only available)
        during that window; Concluir atendimento is always available. It no
        longer completes instantly (Milestone 2A) — it enters the closing
        flow, where the employee records customer outcomes before final
        submission.
      */}
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="min-touch w-full"
          disabled={submitting}
          onClick={onIniciarFechamento}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            ATENDIMENTO_COMPLETE_BUTTON_LABEL
          )}
        </Button>
        {isProvisional && (
          // Visually demoted relative to Concluir atendimento (ghost, no
          // fill, smaller) with a destructive/red accent — this is the
          // accidental-start path, not the expected one. min-touch still
          // guarantees a real mobile touch target regardless of the
          // smaller size.
          <Button
            type="button"
            size="default"
            variant="ghost"
            className="min-touch w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={submitting}
            onClick={onCancelarProvisorio}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              ATENDIMENTO_CANCEL_PROVISORIO_BUTTON_LABEL
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}
