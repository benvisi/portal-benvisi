import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// "brand" is Level 1 (top-level Dashboard tiles) — the strongest, unchanged
// Portal green. "brand-level-2"/"brand-level-3" are the same green hue at
// progressively lower saturation (see --brand-level-2/--brand-level-3 in
// styles.css), used for nav tiles one/two levels deeper in the hierarchy
// (e.g. inside a section hub like Operações) so depth reads as a subtle
// visual cue. "secondary" is unrelated to navigation depth.
type ModuleCardVariant = "brand" | "brand-level-2" | "brand-level-3" | "secondary";

interface ModuleCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  variant: ModuleCardVariant;
  onClick: () => void;
}

const VARIANT_STYLES: Record<ModuleCardVariant, string> = {
  brand: "bg-brand text-brand-foreground hover:bg-brand/90 active:bg-brand/80",
  "brand-level-2":
    "bg-brand-level-2 text-brand-foreground hover:bg-brand-level-2/90 active:bg-brand-level-2/80",
  "brand-level-3":
    "bg-brand-level-3 text-brand-foreground hover:bg-brand-level-3/90 active:bg-brand-level-3/80",
  secondary:
    "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
};

// Icon wrapper and description share one look across all three brand tiers
// — --brand-foreground (white) stays legible on every tier's background, so
// only the card surface itself needs to change per level.
const VARIANT_ICON_WRAPPER: Record<ModuleCardVariant, string> = {
  brand: "bg-brand-foreground/15 text-brand-foreground",
  "brand-level-2": "bg-brand-foreground/15 text-brand-foreground",
  "brand-level-3": "bg-brand-foreground/15 text-brand-foreground",
  secondary: "bg-foreground/10 text-secondary-foreground",
};

const VARIANT_DESCRIPTION: Record<ModuleCardVariant, string> = {
  brand: "text-brand-foreground/80",
  "brand-level-2": "text-brand-foreground/80",
  "brand-level-3": "text-brand-foreground/80",
  secondary: "text-muted-foreground",
};

export function ModuleCard({ icon: Icon, title, description, variant, onClick }: ModuleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-touch flex w-full items-center gap-4 rounded-2xl p-5 text-left shadow-card transition-all active:scale-[0.99]",
        VARIANT_STYLES[variant],
      )}
    >
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
          VARIANT_ICON_WRAPPER[variant],
        )}
      >
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-base font-semibold">{title}</span>
        <span className={cn("text-sm", VARIANT_DESCRIPTION[variant])}>{description}</span>
      </span>
    </button>
  );
}
