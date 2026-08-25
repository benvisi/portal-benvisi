import { Check } from "lucide-react";

import type { AtendimentoChecklistItem } from "@/integrations/supabase/contracts";
import { cn } from "@/lib/utils";

interface ChecklistItemRowProps {
  item: AtendimentoChecklistItem;
  concluido: boolean;
  onToggle: () => void;
}

/**
 * Large tappable card per Checklist V1 confirmation (section 3) — the whole
 * card is the touch target, not a small checkbox within it. guia_bullets
 * render as plain visual bullets under the title, never as their own
 * checkboxes/toggles: they're explanatory guidance for the one real
 * confirmation the card represents, not separate requirements.
 */
export function ChecklistItemRow({ item, concluido, onToggle }: ChecklistItemRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={concluido}
      className={cn(
        "min-touch flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        concluido ? "border-success bg-success/10" : "border-border bg-card hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
          concluido
            ? "border-success bg-success text-success-foreground"
            : "border-input bg-background",
        )}
        aria-hidden
      >
        {concluido && <Check className="h-4 w-4" />}
      </span>
      <span className="flex flex-col gap-1">
        <span className={cn("text-sm font-medium text-foreground", concluido && "font-semibold")}>
          {item.titulo}
        </span>
        {item.guia_bullets && item.guia_bullets.length > 0 && (
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-muted-foreground">
            {item.guia_bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        )}
      </span>
    </button>
  );
}
