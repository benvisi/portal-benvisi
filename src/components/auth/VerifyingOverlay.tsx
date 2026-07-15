import { Loader2 } from "lucide-react";

import { VERIFYING_MESSAGE } from "@/config/constants";

interface VerifyingOverlayProps {
  visible: boolean;
}

export function VerifyingOverlay({ visible }: VerifyingOverlayProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label={VERIFYING_MESSAGE}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/70 backdrop-blur-sm"
    >
      <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
      <p className="text-base font-medium text-foreground">{VERIFYING_MESSAGE}</p>
    </div>
  );
}
