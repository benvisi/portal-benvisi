import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { ROUTES } from "@/config/routes";
import { AuthSession, type AuthSessionData } from "@/lib/session";

export function useRequireSession() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSessionData | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!AuthSession.isAuthenticated()) {
      void navigate({ to: ROUTES.LOGIN, replace: true });
      return;
    }
    setSession(AuthSession.get());
    setReady(true);
  }, [navigate]);

  return { session, ready };
}
