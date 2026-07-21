import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { SHIFT_START_ERROR_MESSAGE } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";

function shiftStartQueryKey(funcionarioId: string) {
  return ["turno-presenca-hoje", funcionarioId] as const;
}

async function fetchShiftStartToday(sessionToken: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_turno_presenca_hoje", {
    p_session_token: sessionToken,
  });

  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("get_turno_presenca_hoje returned no boolean");

  return data;
}

/**
 * funcionarioId is used only as a stable, human-readable cache key (safe for
 * non-privileged purposes). The actual privileged RPC calls are authorized
 * exclusively by sessionToken — the server derives id_funcionario from it.
 */
export function useShiftStart(funcionarioId: string | null, sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: funcionarioId ? shiftStartQueryKey(funcionarioId) : ["turno-presenca-hoje", null],
    queryFn: () => fetchShiftStartToday(sessionToken as string),
    enabled: funcionarioId !== null && sessionToken !== null,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.error) handleSessionError(query.error);
  }, [query.error, handleSessionError]);

  const onStart = useCallback(async () => {
    if (submitting || !funcionarioId || !sessionToken) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.rpc("registrar_turno_presenca", {
        p_session_token: sessionToken,
      });

      if (error) throw error;
      if (data !== true) {
        throw new Error("registrar_turno_presenca did not report success");
      }

      queryClient.setQueryData(shiftStartQueryKey(funcionarioId), true);
    } catch (error) {
      console.error("[useShiftStart] registrar_turno_presenca failed:", error);
      if (handleSessionError(error)) return;
      setErrorMessage(SHIFT_START_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, funcionarioId, sessionToken, queryClient, handleSessionError]);

  return {
    isLoading: query.isLoading,
    hasError: query.isError,
    startedToday: query.data === true,
    submitting,
    errorMessage,
    onStart,
  };
}
