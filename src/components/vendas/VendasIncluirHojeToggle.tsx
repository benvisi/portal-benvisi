import { Check } from "lucide-react";

import { RELATORIO_VENDAS_INCLUIR_HOJE_LABEL } from "@/config/constants";
import { cn } from "@/lib/utils";

interface VendasIncluirHojeToggleProps {
  value: boolean;
  onChange: (incluirHoje: boolean) => void;
}

/** Independent on/off chip: green with a check when today is included (Sim), quiet when not (Não). */
export function VendasIncluirHojeToggle({ value, onChange }: VendasIncluirHojeToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        value
          ? "border-brand bg-brand text-brand-foreground"
          : "border-border bg-transparent text-muted-foreground",
      )}
    >
      {value && <Check className="h-4 w-4" aria-hidden />}
      {RELATORIO_VENDAS_INCLUIR_HOJE_LABEL}
    </button>
  );
}
