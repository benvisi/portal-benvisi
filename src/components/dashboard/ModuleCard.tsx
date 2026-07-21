import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type ModuleCardVariant = "brand" | "secondary";

interface ModuleCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  variant: ModuleCardVariant;
  onClick: () => void;
}

const VARIANT_STYLES: Record<ModuleCardVariant, string> = {
  brand: "bg-brand text-brand-foreground hover:bg-brand/90 active:bg-brand/80",
  secondary:
    "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
};

const VARIANT_ICON_WRAPPER: Record<ModuleCardVariant, string> = {
  brand: "bg-brand-foreground/15 text-brand-foreground",
  secondary: "bg-foreground/10 text-secondary-foreground",
};

const VARIANT_DESCRIPTION: Record<ModuleCardVariant, string> = {
  brand: "text-brand-foreground/80",
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
