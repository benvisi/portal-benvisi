import { useCallback, useState } from "react";

import type { MotivoCategoria } from "@/integrations/supabase/contracts";

export interface ClienteRascunho {
  localId: string;
  categoria: MotivoCategoria | null;
  idMotivo: string | null;
  detalhe: string;
}

function novoRascunho(): ClienteRascunho {
  return { localId: crypto.randomUUID(), categoria: null, idMotivo: null, detalhe: "" };
}

/**
 * Local-only draft state for the closing flow's customer entries and
 * Checklist V1 responses. Never derived from or written back to server
 * query data — TanStack Query refetches of
 * get_atendimento_ativo/get_lista_vez_estado while this is mounted cannot
 * erase it. Intentionally not persisted anywhere: a page refresh during
 * closing loses the draft by design (see Milestone 2A handoff notes) —
 * only the fact that the Atendimento is in the "finalizando" state
 * survives, not the in-progress form contents. Checklist responses are
 * keyed by item codigo (Record<string, boolean>) rather than a fixed set of
 * fields, matching the backend's versioned item catalog — this draft shape
 * doesn't need to change if a future Checklist V2 adds/removes items.
 */
export function useFechamentoDraft() {
  const [clientes, setClientes] = useState<ClienteRascunho[]>(() => [novoRascunho()]);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const adicionar = useCallback(() => {
    setClientes((prev) => [...prev, novoRascunho()]);
  }, []);

  const remover = useCallback((localId: string) => {
    setClientes((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.localId !== localId)));
  }, []);

  const atualizar = useCallback((localId: string, patch: Partial<ClienteRascunho>) => {
    setClientes((prev) => prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)));
  }, []);

  const alternarItemChecklist = useCallback((codigo: string) => {
    setChecklist((prev) => ({ ...prev, [codigo]: !prev[codigo] }));
  }, []);

  const reset = useCallback(() => {
    setClientes([novoRascunho()]);
    setChecklist({});
  }, []);

  const isDirty =
    clientes.some(
      (c) => c.categoria !== null || c.idMotivo !== null || c.detalhe.trim().length > 0,
    ) || Object.values(checklist).some(Boolean);

  return {
    clientes,
    checklist,
    adicionar,
    remover,
    atualizar,
    alternarItemChecklist,
    reset,
    isDirty,
  };
}

export type FechamentoDraft = ReturnType<typeof useFechamentoDraft>;
