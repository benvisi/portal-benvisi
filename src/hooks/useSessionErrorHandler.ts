import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { SESSION_EXPIRED_MESSAGE } from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { AuthSession } from "@/lib/session";
import { isInvalidSessionError } from "@/lib/session-error";

/**
 * Shared handler for RPCs guarded by validate_session_token. When an RPC
 * reports the session as invalid/expired/revoked/inactive, this clears the
 * local session and redirects to Login with a friendly message. Ordinary
 * network/infrastructure errors are left untouched (returns false) so
 * callers can show their own transient-error UI instead.
 */
export function useSessionErrorHandler() {
  const navigate = useNavigate();

  return useCallback(
    (error: unknown): boolean => {
      if (!isInvalidSessionError(error)) return false;

      AuthSession.clear();
      toast(SESSION_EXPIRED_MESSAGE);
      void navigate({ to: ROUTES.LOGIN, replace: true });
      return true;
    },
    [navigate],
  );
}
