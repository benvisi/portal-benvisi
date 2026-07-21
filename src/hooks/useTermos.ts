import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { TERMS_ACCEPT_ERROR_MESSAGE, TERMS_FULL_TEXT, TERMS_VERSION } from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useTermoStatus } from "@/hooks/useTermoStatus";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import { useSignOut } from "@/hooks/useSignOut";

export function useTermos() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, ready } = useRequireSession();
  const handleSessionError = useSessionErrorHandler();
  const signOut = useSignOut();

  const funcionarioId = session?.funcionario_id ?? null;
  const sessionToken = session?.session_token ?? null;
  const statusQuery = useTermoStatus(funcionarioId, sessionToken);

  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const alreadyAccepted = statusQuery.data === true;

  useEffect(() => {
    if (ready && alreadyAccepted) {
      void navigate({ to: ROUTES.DASHBOARD, replace: true });
    }
  }, [ready, alreadyAccepted, navigate]);

  const onAccept = useCallback(async () => {
    if (submitting || !sessionToken) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.rpc("accept_termo", {
        p_session_token: sessionToken,
        p_versao_termo: TERMS_VERSION,
        p_texto_termo: TERMS_FULL_TEXT,
      });

      if (error) throw error;
      if (data !== true) {
        throw new Error("accept_termo did not report success");
      }

      queryClient.setQueryData(["termo-status", funcionarioId, TERMS_VERSION], true);
      await navigate({ to: ROUTES.DASHBOARD, replace: true });
    } catch (error) {
      console.error("[useTermos] accept_termo failed:", error);
      if (handleSessionError(error)) return;
      setErrorMessage(TERMS_ACCEPT_ERROR_MESSAGE);
      setSubmitting(false);
    }
  }, [submitting, sessionToken, funcionarioId, queryClient, navigate, handleSessionError]);

  return {
    session,
    ready,
    // isFetching (not just isLoading/isPending) matters here: a query that
    // previously errored keeps status "error" while it silently refetches in
    // the background, so gating only on isLoading would let a stale error
    // flash before the refetch's outcome replaces it.
    isCheckingStatus: ready && (statusQuery.isPending || statusQuery.isFetching),
    statusError: statusQuery.isError && !statusQuery.isFetching ? statusQuery.error : null,
    onRetryStatus: statusQuery.refetch,
    showTerms: ready && statusQuery.isSuccess && !alreadyAccepted,
    checked,
    setChecked,
    submitting,
    errorMessage,
    onAccept,
    onSignOut: signOut,
  };
}
