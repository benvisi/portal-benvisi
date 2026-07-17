import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import {
  LOCALE_PT_BR,
  LOGIN_ERROR_MESSAGE,
  PIN_LENGTH,
  PIN_SHAKE_DURATION_MS,
} from "@/config/constants";
import { ROUTES } from "@/config/routes";
import { supabase } from "@/integrations/supabase/client";
import {
  isVerifyPinSuccess,
  type VerifyPinSuccess,
} from "@/integrations/supabase/contracts";
import { AuthSession } from "@/lib/session";
import { HapticService } from "@/lib/haptic-service";
import { useEmployeeQuery } from "@/hooks/useEmployeeQuery";

export type LoginStage = "selecting" | "entering-pin" | "verifying";

function normalize(value: string): string {
  return value
    .toLocaleLowerCase(LOCALE_PT_BR)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function completeSession(result: VerifyPinSuccess): void {
  AuthSession.save({
    funcionario_id: result.funcionario_id,
    nome: result.nome,
    cargo: result.cargo,
    timestamp_login: new Date().toISOString(),
  });
}

export function useLogin() {
  const navigate = useNavigate();
  const employeesQuery = useEmployeeQuery();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<LoginStage>("selecting");
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const employees = employeesQuery.data ?? [];

  const filtered = useMemo(() => {
    const normalized = normalize(query.trim());
    if (!normalized) return employees;
    return employees.filter((employee) =>
      normalize(employee.nome).includes(normalized),
    );
  }, [employees, query]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.funcionario_id === selectedId) ?? null,
    [employees, selectedId],
  );

  const clearPin = useCallback(() => {
    setPin("");
    setHasError(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const clear = () => {
      setPin("");
      setHasError(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") clear();
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!hasError) return;
    const timeout = window.setTimeout(() => setHasError(false), PIN_SHAKE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [hasError]);

  const handleSelectEmployee = useCallback((id: string) => {
    setSelectedId(id);
    setPin("");
    setErrorMessage(null);
    setHasError(false);
    setStage("entering-pin");
    setQuery("");
  }, []);

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setPin("");
    setErrorMessage(null);
    setHasError(false);
    setStage("selecting");
  }, []);

  const verify = useCallback(
    async (funcionarioId: string, pinValue: string) => {
      setStage("verifying");
      setErrorMessage(null);
      try {
        const { data, error } = await supabase.rpc("verify_pin", {
          p_funcionario_id: funcionarioId,
          p_pin: pinValue,
        });

        if (error) throw error;

        const result = Array.isArray(data) ? data[0] : data;

        if (!result) {
          throw new Error("verify_pin returned no row");
        }

        if (isVerifyPinSuccess(result)) {
          completeSession(result);
          HapticService.vibrate("success");
          await navigate({ to: ROUTES.DASHBOARD, replace: true });
          return;
        }

        HapticService.vibrate("error");
        setErrorMessage(LOGIN_ERROR_MESSAGE);
        setHasError(true);
        setPin("");
        setStage("entering-pin");
      } catch (error) {
        console.error("[useLogin] verify_pin infrastructure failure:", error);
        HapticService.vibrate("error");
        setErrorMessage(
          "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
        );
        setHasError(true);
        setPin("");
        setStage("entering-pin");
      }
    },
    [navigate],
  );

  const handleDigit = useCallback(
    (digit: string) => {
      if (stage !== "entering-pin") return;
      if (!selectedEmployee) return;
      if (pin.length >= PIN_LENGTH) return;
      HapticService.vibrate("tap");
      const next = pin + digit;
      setPin(next);
      setErrorMessage(null);
      if (next.length === PIN_LENGTH) {
        void verify(selectedEmployee.funcionario_id, next);
      }
    },
    [pin, selectedEmployee, stage, verify],
  );

  const handleBackspace = useCallback(() => {
    if (stage !== "entering-pin") return;
    HapticService.vibrate("tap");
    setPin((current) => current.slice(0, -1));
    setErrorMessage(null);
  }, [stage]);

  return {
    isLoading: employeesQuery.isLoading,
    loadError: employeesQuery.error,
    employees: filtered,
    query,
    setQuery,
    selectedEmployee,
    selectedId,
    onSelectEmployee: handleSelectEmployee,
    onBack: handleBack,
    pin,
    stage,
    hasError,
    errorMessage,
    onDigit: handleDigit,
    onBackspace: handleBackspace,
    clearPin,
  };
}
