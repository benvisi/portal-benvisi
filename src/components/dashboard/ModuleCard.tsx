import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Navigation-depth tiers (Blueprint section 14.8) — a deliberately
// perceptible step per level, not a subtle math-only color shift, so depth
// is legible at a glance rather than something you'd need to A/B compare
// to notice:
// - "brand" is Level 1 (top-level Dashboard tiles) — the existing dark
//   brand green, unchanged, with white text/icons.
// - "brand-level-2" is one level deeper (e.g. inside a section hub like
//   Operações or Conhecimento & Cultura) — a clearly lighter/brighter
//   medium green, same 158° hue family, still with white text/icons
//   (contrast-checked — see --brand-level-2 in styles.css).
// - "brand-level-3" is reserved for a still-deeper future tier — no such
//   navigation surface exists in the app today, so this is defined but
//   unused. It reuses the same pale green as the table `--zebra` stripe
//   (not an independently-invented near-duplicate color), which is light
//   enough that it needs DARK text/icons rather than white — see below.
// "secondary" is unrelated to navigation depth.
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
  // Pale background (same as --zebra) — dark foreground, unlike the two
  // darker tiers above, matching how the app already pairs --zebra with
  // dark text elsewhere (Estoque/Contagem zebra rows use text-foreground).
  "brand-level-3":
    "bg-brand-level-3 text-foreground hover:bg-brand-level-3/90 active:bg-brand-level-3/80",
  secondary:
    "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
};

// Icon wrapper and description share one look across the two dark brand
// tiers (Level 1/2) — --brand-foreground (white) stays legible on both. The
// pale Level 3 tier mirrors "secondary"'s light-background treatment
// instead (dark icon/text), since white would not be legible on it.
const VARIANT_ICON_WRAPPER: Record<ModuleCardVariant, string> = {
  brand: "bg-brand-foreground/15 text-brand-foreground",
  "brand-level-2": "bg-brand-foreground/15 text-brand-foreground",
  "brand-level-3": "bg-foreground/10 text-foreground",
  secondary: "bg-foreground/10 text-secondary-foreground",
};

const VARIANT_DESCRIPTION: Record<ModuleCardVariant, string> = {
  brand: "text-brand-foreground/80",
  "brand-level-2": "text-brand-foreground/80",
  "brand-level-3": "text-muted-foreground",
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
