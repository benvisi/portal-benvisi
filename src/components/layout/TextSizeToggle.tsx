import { ALargeSmall } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  TEXT_SIZE_EXTRA_LABEL,
  TEXT_SIZE_GRANDE_LABEL,
  TEXT_SIZE_PADRAO_LABEL,
  TEXT_SIZE_TOGGLE_LABEL,
} from "@/config/constants";
import { useTextSizePreference } from "@/hooks/useTextSizePreference";
import type { TextSizePreference } from "@/lib/text-size";

/**
 * Small accessibility MVP (Blueprint section 14.5): the text-size
 * preference control, now with three steps (Padrão / Maior / Extra
 * grande). Rendered by AuthUtilityBar, so it appears in the same bottom
 * utility area on every authenticated route (Milestone 4C.3 polish) — a
 * subtle "Aa" trigger whose options stay hidden until tapped, keeping the
 * row visually quiet rather than permanently showing all option labels.
 *
 * Each chip's own label is rendered at a size representative of the size
 * it activates (text-sm / text-base / text-lg) so the picker itself shows
 * what each option looks like. `min-touch` plus the toggle's own
 * items-center/justify-center keep every chip a clean, equally tappable
 * target despite the different label sizes.
 */
export function TextSizeToggle() {
  const { preference, setPreference } = useTextSizePreference();

  const handleValueChange = (value: string) => {
    // Radix's single-select ToggleGroup reports "" when the already-active
    // item is clicked again — ignored, since exactly one of the three
    // options must always stay selected.
    if (value === "padrao" || value === "grande" || value === "extra") {
      setPreference(value satisfies TextSizePreference);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-touch text-muted-foreground hover:text-foreground"
          aria-label={TEXT_SIZE_TOGGLE_LABEL}
        >
          <ALargeSmall className="h-5 w-5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={preference}
          onValueChange={handleValueChange}
          aria-label={TEXT_SIZE_TOGGLE_LABEL}
          className="gap-2"
        >
          <ToggleGroupItem value="padrao" className="min-touch text-sm">
            {TEXT_SIZE_PADRAO_LABEL}
          </ToggleGroupItem>
          <ToggleGroupItem value="grande" className="min-touch text-base">
            {TEXT_SIZE_GRANDE_LABEL}
          </ToggleGroupItem>
          <ToggleGroupItem value="extra" className="min-touch text-lg">
            {TEXT_SIZE_EXTRA_LABEL}
          </ToggleGroupItem>
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}
