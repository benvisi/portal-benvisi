import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { ROUTES } from "@/config/routes";
import { AuthSession } from "@/lib/session";

/**
 * Guards the Login route ("/") itself. AuthSession now persists across tab
 * close/reopen and browser restarts (localStorage), but the Login route
 * previously never checked it — it unconditionally rendered PIN entry, so a
 * returning employee who still had a perfectly valid session was forced
 * through login again simply because "/" is where reopening the Portal
 * lands. This mirrors useRequireSession's local-presence check (the mirror
 * image: redirect away from Login instead of to it) and leaves server-side
 * validation exactly where it already lives — if the session turns out to
 * be revoked/expired/deactivated, the Dashboard's own RPC calls catch that
 * via useSessionErrorHandler and bounce back here, same as every other
 * protected route.
 */
export function useRedirectIfAuthenticated() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (AuthSession.isAuthenticated()) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
      return;
    }
    setReady(true);
  }, [navigate]);

  return { ready };
}
