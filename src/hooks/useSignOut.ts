import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { ROUTES } from "@/config/routes";
import { supabase } from "@/integrations/supabase/client";
import { AuthSession } from "@/lib/session";

/**
 * Shared sign-out flow for both Dashboard and Terms: best-effort server-side
 * revocation, then unconditional local cleanup and redirect. A network
 * failure while revoking must never trap the employee on the page.
 *
 * Clearing the query cache here matters: query keys like ["termo-status", id]
 * are keyed by funcionario_id, not by session. Without this, a stale
 * success/error result from one session (or from testing an expired/invalid
 * session) would still be sitting in the cache the next time that same
 * employee logs in, and would render for a moment before the fresh
 * background refetch replaced it.
 */
export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useCallback(async () => {
    const session = AuthSession.get();

    if (session) {
      try {
        await supabase.rpc("revoke_employee_session", {
          p_session_token: session.session_token,
        });
      } catch (error) {
        console.error("[useSignOut] revoke_employee_session failed:", error);
      }
    }

    AuthSession.clear();
    queryClient.clear();
    void navigate({ to: ROUTES.LOGIN, replace: true });
  }, [navigate, queryClient]);
}
