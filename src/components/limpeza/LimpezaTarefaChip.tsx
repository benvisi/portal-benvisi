import { LIMPEZA_TAREFA_ICONS, LIMPEZA_TAREFA_LABELS } from "@/config/constants";
import type { LimpezaTarefa } from "@/integrations/supabase/contracts";
import { cn } from "@/lib/utils";

const TAREFA_CHIP_STYLES: Record<LimpezaTarefa, string> = {
  // Subtle, brand-derived tint — not a saturated color, and never the only
  // signal (icon + text label are always present too).
  varrer: "bg-brand/10 text-brand",
  passar_pano: "bg-accent text-accent-foreground",
};

interface LimpezaTarefaChipProps {
  tarefa: LimpezaTarefa;
  className?: string;
}

export function LimpezaTarefaChip({ tarefa, className }: LimpezaTarefaChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        TAREFA_CHIP_STYLES[tarefa],
        className,
      )}
    >
      <span aria-hidden>{LIMPEZA_TAREFA_ICONS[tarefa]}</span>
      {LIMPEZA_TAREFA_LABELS[tarefa]}
    </span>
  );
}
