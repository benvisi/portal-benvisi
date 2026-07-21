import { CheckCircle2, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SHIFT_START_BUTTON_LABEL,
  SHIFT_START_DESCRIPTION,
  SHIFT_START_SUCCESS_LABEL,
  SHIFT_START_TITLE,
} from "@/config/constants";
import { useShiftStart } from "@/hooks/useShiftStart";

interface ShiftStartCardProps {
  funcionarioId: string;
  sessionToken: string | null;
}

export function ShiftStartCard({ funcionarioId, sessionToken }: ShiftStartCardProps) {
  const shift = useShiftStart(funcionarioId, sessionToken);

  if (shift.startedToday) {
    return (
      <div className="flex w-full items-center gap-2 px-1 py-2">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
        <span className="text-sm font-medium text-foreground">{SHIFT_START_SUCCESS_LABEL}</span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl bg-primary p-6 text-primary-foreground shadow-card">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15">
          <Play className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-lg font-semibold">{SHIFT_START_TITLE}</span>
          <span className="text-sm text-primary-foreground/80">{SHIFT_START_DESCRIPTION}</span>
        </div>
      </div>

      {shift.errorMessage && (
        <p role="alert" aria-live="polite" className="text-sm font-medium text-primary-foreground">
          {shift.errorMessage}
        </p>
      )}

      <Button
        type="button"
        size="lg"
        variant="secondary"
        className="min-touch w-full"
        disabled={shift.submitting || shift.isLoading}
        onClick={() => void shift.onStart()}
      >
        {shift.submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {SHIFT_START_BUTTON_LABEL}
          </>
        ) : (
          SHIFT_START_BUTTON_LABEL
        )}
      </Button>
    </div>
  );
}
