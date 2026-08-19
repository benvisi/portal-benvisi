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
 * Local-only draft state for the closing flow's customer entries. Never
 * derived from or written back to server query data — TanStack Query
 * refetches of get_atendimento_ativo/get_lista_vez_estado while this is
 * mounted cannot erase it. Intentionally not persisted anywhere: a page
 * refresh during closing loses the draft by design (see Milestone 2A
 * handoff notes) — only the fact that the Atendimento is in the
 * "finalizando" state survives, not the in-progress form contents.
 */
export function useFechamentoDraft() {
  const [clientes, setClientes] = useState<ClienteRascunho[]>(() => [novoRascunho()]);

  const adicionar = useCallback(() => {
    setClientes((prev) => [...prev, novoRascunho()]);
  }, []);

  const remover = useCallback((localId: string) => {
    setClientes((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.localId !== localId)));
  }, []);

  const atualizar = useCallback((localId: string, patch: Partial<ClienteRascunho>) => {
    setClientes((prev) => prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)));
  }, []);

  const reset = useCallback(() => {
    setClientes([novoRascunho()]);
  }, []);

  const isDirty = clientes.some(
    (c) => c.categoria !== null || c.idMotivo !== null || c.detalhe.trim().length > 0,
  );

  return { clientes, adicionar, remover, atualizar, reset, isDirty };
}

export type FechamentoDraft = ReturnType<typeof useFechamentoDraft>;
