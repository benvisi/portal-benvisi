import { LogOut } from "lucide-react";

import { TextSizeToggle } from "@/components/layout/TextSizeToggle";
import { Button } from "@/components/ui/button";
import { SIGN_OUT_BUTTON_LABEL } from "@/config/constants";
import { useSignOut } from "@/hooks/useSignOut";

interface AuthUtilityBarProps {
  /**
   * Hide the "Sair" button on screens that already provide their own
   * sign-out affordance (e.g. Termo's accept/decline pair), so the two
   * never stack incoherently.
   */
  showSignOut?: boolean;
}

/**
 * The bottom utility area shared by every authenticated employee-facing
 * route (Milestone 4C.3 polish): the "Texto maior" control and "Sair",
 * always in the same place. Rendered as the last child of each route's
 * <main>, in normal document flow (no fixed/sticky/overlay) so it never
 * covers content on any viewport. `mx-auto max-w-lg` keeps it aligned with
 * the route's content column; flex-wrap lets the two controls stack on very
 * narrow widths rather than losing their labels.
 *
 * This is deliberately a per-route component rather than a router layout
 * route — the routes share no layout wrapper today, and a pathless layout
 * route would mean restructuring every route file. A future layout route
 * could host this so new routes inherit it automatically.
 */
export function AuthUtilityBar({ showSignOut = true }: AuthUtilityBarProps) {
  const signOut = useSignOut();

  return (
    <div className="mx-auto mt-6 flex w-full max-w-lg flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <TextSizeToggle />
      {showSignOut && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-touch gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => void signOut()}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {SIGN_OUT_BUTTON_LABEL}
        </Button>
      )}
    </div>
  );
}
