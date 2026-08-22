import { useState } from "react";

import { StandaloneChecklistDialog } from "@/components/checklist/StandaloneChecklistDialog";
import {
  CHECKLIST_PENDENCIAS_SUPPORT_TEXT,
  getChecklistPendenciasCountLabel,
} from "@/config/constants";
import { useChecklistPendenciasCount } from "@/hooks/useChecklistPendenciasCount";

interface PendingChecklistIndicatorProps {
  funcionarioId: string | null;
  sessionToken: string | null;
}

/**
 * Milestone 2C.2, section 9/10/38: the single shared component/hook pair
 * backing the persistent pending-checklist reminder across authenticated
 * employee-facing pages (currently mounted on the dashboard and
 * Atendimento). Self-contained — owns its own standalone-completion dialog
 * state — so host pages only need to mount this once with the session
 * identifiers they already have, no per-page dialog plumbing or duplicated
 * query logic. Renders nothing while loading or at zero pending, exactly
 * like 2C.1's original banner did, so there is no layout flash before the
 * authoritative count is known.
 */
export function PendingChecklistIndicator({
  funcionarioId,
  sessionToken,
}: PendingChecklistIndicatorProps) {
  const pendenciasQuery = useChecklistPendenciasCount(funcionarioId, sessionToken);
  const [dialogOpen, setDialogOpen] = useState(false);

  const count = pendenciasQuery.data;
  if (count === undefined || count <= 0) return null;

  return (
    <>
      {/*
        Same width/radius as the primary Card-based content on this page
        (rounded-xl, full content width) rather than a narrow self-sized
        pill, so it reads as part of the page's shared content grid instead
        of a visually disconnected floating chip — still compact vertically
        (single padded row) and restrained (amber tint, no heavy border or
        oversized text) so it doesn't read as a warning/error banner. No
        chevron/icon affordance: the "Toque para concluir agora" copy
        already states it's tappable, so an icon would just be redundant.
      */}
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="min-touch flex w-full flex-col gap-0.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-left transition-colors hover:bg-warning/15"
      >
        <span className="text-sm font-semibold text-warning">
          {getChecklistPendenciasCountLabel(count)}
        </span>
        <span className="text-xs text-muted-foreground">{CHECKLIST_PENDENCIAS_SUPPORT_TEXT}</span>
      </button>

      <StandaloneChecklistDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        funcionarioId={funcionarioId}
        sessionToken={sessionToken}
      />
    </>
  );
}
