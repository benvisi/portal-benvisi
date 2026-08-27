import { ALargeSmall } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  TEXT_SIZE_GRANDE_LABEL,
  TEXT_SIZE_PADRAO_LABEL,
  TEXT_SIZE_TOGGLE_LABEL,
} from "@/config/constants";
import { useTextSizePreference } from "@/hooks/useTextSizePreference";
import type { TextSizePreference } from "@/lib/text-size";

/**
 * Small accessibility MVP (Blueprint section 14.5): the "Texto maior"
 * preference control. Rendered by AuthUtilityBar, so it appears in the same
 * bottom utility area on every authenticated route (Milestone 4C.3 polish) —
 * a subtle "Aa" trigger whose Padrão / Texto maior options stay hidden until
 * tapped, keeping the row visually quiet rather than permanently showing
 * both option labels.
 */
export function TextSizeToggle() {
  const { preference, setPreference } = useTextSizePreference();

  const handleValueChange = (value: string) => {
    // Radix's single-select ToggleGroup reports "" when the already-active
    // item is clicked again — ignored, since exactly one of the two
    // options must always stay selected.
    if (value === "padrao" || value === "grande") {
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
          <ToggleGroupItem value="padrao" className="min-touch">
            {TEXT_SIZE_PADRAO_LABEL}
          </ToggleGroupItem>
          <ToggleGroupItem value="grande" className="min-touch">
            {TEXT_SIZE_GRANDE_LABEL}
          </ToggleGroupItem>
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}
