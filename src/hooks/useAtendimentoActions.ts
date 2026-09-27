import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ATENDIMENTO_GENERIC_ERROR_MESSAGE } from "@/config/constants";
import { isAtendimentoIniciado } from "@/integrations/supabase/contracts";
import { atendimentoAtivoQueryKey } from "@/hooks/useAtendimentoAtivo";
import { atendimentoResumoHojeQueryKey } from "@/hooks/useAtendimentoResumoHoje";
import { checklistPendenciasCountQueryKey } from "@/hooks/useChecklistPendenciasCount";
import { listaVezQueryKey } from "@/hooks/useListaVez";
import { useSessionErrorHandler } from "@/hooks/useSessionErrorHandler";
import {
  getAtendimentoErrorMessage,
  isForaDeOrdemConfirmationRequired,
} from "@/lib/atendimento-error";

export type IniciarAtendimentoResult = "ok" | "requires_confirmation" | "error";

export interface ClienteOutcomeInput {
  id_motivo: string;
  detalhe: string | null;
}

export interface ChecklistRespostaInput {
  codigo: string;
  concluido: boolean;
}

async function iniciarAtendimentoRpc(
  sessionToken: string,
  confirmarForaDeOrdem: boolean,
  idFuncionarioAlvo: string | null,
) {
  const { data, error } = await supabase.rpc("iniciar_atendimento", {
    p_session_token: sessionToken,
    p_confirmar_fora_de_ordem: confirmarForaDeOrdem,
    p_id_funcionario_alvo: idFuncionarioAlvo,
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const row = rows[0];
  if (row === undefined || !isAtendimentoIniciado(row)) {
    throw new Error("iniciar_atendimento returned no Atendimento row");
  }
  return row;
}

/**
 * Bundles every Atendimento mutation (start, cancel-provisional, enter
 * closing, abandon closing, final submission) behind one submitting/error
 * state, mirroring useShiftStart's shape. Every successful call invalidates
 * both the active-Atendimento and Lista da Vez queries for this employee,
 * since all of these RPCs change at least one of those.
 */
export function useAtendimentoActions(funcionarioId: string | null, sessionToken: string | null) {
  const queryClient = useQueryClient();
  const handleSessionError = useSessionErrorHandler();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    if (!funcionarioId) return;
    void queryClient.invalidateQueries({ queryKey: atendimentoAtivoQueryKey(funcionarioId) });
    void queryClient.invalidateQueries({ queryKey: listaVezQueryKey(funcionarioId) });
    void queryClient.invalidateQueries({
      queryKey: checklistPendenciasCountQueryKey(funcionarioId),
    });
  }, [queryClient, funcionarioId]);

  // Card #36: only the finalization RPCs below (concluir/adiarChecklist/
  // concluirPendente/concluirComoGerente*) actually create a new concluded
  // Atendimento — start/cancel/enter-closing/voltar never do, so this is
  // invoked separately from invalidate() above rather than folded into it.
  // Scoped to the caller's own cached query only; the resumo-hoje card
  // otherwise refreshes for everyone via its own 60s poll.
  const invalidateResumoHoje = useCallback(() => {
    if (!funcionarioId) return;
    void queryClient.invalidateQueries({ queryKey: atendimentoResumoHojeQueryKey(funcionarioId) });
  }, [queryClient, funcionarioId]);

  const runBooleanRpc = useCallback(
    async (
      rpcName: string,
      params: Record<string, unknown>,
      errorLabel: string,
      alsoInvalidateResumoHoje = false,
    ): Promise<boolean> => {
      if (submitting || !sessionToken) return false;
      setSubmitting(true);
      setErrorMessage(null);

      try {
        const { data, error } = await supabase.rpc(rpcName, params);
        if (error) throw error;
        if (data !== true) throw new Error(`${rpcName} did not report success`);
        invalidate();
        if (alsoInvalidateResumoHoje) invalidateResumoHoje();
        return true;
      } catch (error) {
        console.error(`[useAtendimentoActions] ${errorLabel} failed:`, error);
        if (handleSessionError(error)) return false;
        setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, invalidate, invalidateResumoHoje, handleSessionError],
  );

  const iniciar = useCallback(
    async (
      confirmarForaDeOrdem: boolean,
      idFuncionarioAlvo?: string,
    ): Promise<IniciarAtendimentoResult> => {
      if (submitting || !sessionToken) return "error";
      setSubmitting(true);
      setErrorMessage(null);

      try {
        await iniciarAtendimentoRpc(sessionToken, confirmarForaDeOrdem, idFuncionarioAlvo ?? null);
        invalidate();
        return "ok";
      } catch (error) {
        console.error("[useAtendimentoActions] iniciar_atendimento failed:", error);
        if (handleSessionError(error)) return "error";
        if (isForaDeOrdemConfirmationRequired(error)) {
          // The client's queue snapshot was stale (someone else changed the
          // queue between render and this call) — refresh it and let the
          // caller show the same out-of-turn confirmation it would have
          // shown had the snapshot been fresh, instead of failing silently.
          invalidate();
          return "requires_confirmation";
        }
        setErrorMessage(getAtendimentoErrorMessage(error) ?? ATENDIMENTO_GENERIC_ERROR_MESSAGE);
        return "error";
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, sessionToken, invalidate, handleSessionError],
  );

  const cancelar = useCallback(
    (idAtendimento: string) =>
      runBooleanRpc(
        "cancelar_atendimento_provisorio",
        { p_session_token: sessionToken, p_id_atendimento: idAtendimento },
        "cancelar_atendimento_provisorio",
      ),
    [runBooleanRpc, sessionToken],
  );

  const iniciarFechamento = useCallback(
    () =>
      runBooleanRpc(
        "iniciar_fechamento_atendimento",
        { p_session_token: sessionToken },
        "iniciar_fechamento_atendimento",
      ),
    [runBooleanRpc, sessionToken],
  );

  const voltarAoAtendimento = useCallback(
    () =>
      runBooleanRpc(
        "voltar_ao_atendimento",
        { p_session_token: sessionToken },
        "voltar_ao_atendimento",
      ),
    [runBooleanRpc, sessionToken],
  );

  const concluir = useCallback(
    (clientes: ClienteOutcomeInput[], checklist: ChecklistRespostaInput[]) =>
      runBooleanRpc(
        "concluir_atendimento",
        {
          p_session_token: sessionToken,
          p_clientes: clientes,
          p_checklist: checklist,
          p_adiar_checklist: false,
        },
        "concluir_atendimento",
        true,
      ),
    [runBooleanRpc, sessionToken],
  );

  // Milestone 2C.1: explicit, separate intent from concluir — never inferred
  // from an incomplete checklist. p_checklist is omitted entirely (the
  // backend never inspects it when p_adiar_checklist is true).
  const adiarChecklist = useCallback(
    (clientes: ClienteOutcomeInput[]) =>
      runBooleanRpc(
        "concluir_atendimento",
        {
          p_session_token: sessionToken,
          p_clientes: clientes,
          p_checklist: [],
          p_adiar_checklist: true,
        },
        "concluir_atendimento (adiar checklist)",
        true,
      ),
    [runBooleanRpc, sessionToken],
  );

  // Milestone 2D: recovery completion for a previous-day pendente_fechamento
  // Atendimento. No p_adiar_checklist parameter exists on this RPC at all —
  // Farei depois is never offered during recovery (section 14).
  const concluirPendente = useCallback(
    (clientes: ClienteOutcomeInput[], checklist: ChecklistRespostaInput[]) =>
      runBooleanRpc(
        "concluir_atendimento_pendente",
        {
          p_session_token: sessionToken,
          p_clientes: clientes,
          p_checklist: checklist,
        },
        "concluir_atendimento_pendente",
        true,
      ),
    [runBooleanRpc, sessionToken],
  );

  // Conclusão gerencial, part 1: the em_atendimento -> finalizando takeover
  // itself (20260923 correction) — a Gerente/Administrador advancing
  // another employee's still-active Atendimento so its timer stops and the
  // closing form can be filled out on their behalf, exactly like the
  // salesperson tapping "Concluir atendimento" themselves would. Targets an
  // explicit Atendimento id, never the caller's own row. On success the
  // caller opens the same closing form used for an already-finalizando
  // target (concluirComoGerente below).
  const iniciarFechamentoComoGerente = useCallback(
    (idAtendimento: string) =>
      runBooleanRpc(
        "iniciar_fechamento_atendimento_gerencial",
        { p_session_token: sessionToken, p_id_atendimento: idAtendimento },
        "iniciar_fechamento_atendimento_gerencial",
      ),
    [runBooleanRpc, sessionToken],
  );

  // Conclusão gerencial, part 2: a Gerente/Administrador completing another
  // employee's Atendimento on their behalf (e.g. the employee lost Portal
  // access mid-shift). Ownership stays with the original employee — this
  // only ever changes who performed the action, server-side. No
  // p_adiar_checklist parameter, same reasoning as concluirPendente: Farei
  // depois is never offered in the management flow. p_ignorar_checklist is
  // explicit here (rather than relying on the RPC's default) so both this
  // and the exception variant below read as two distinct, intentional
  // calls rather than one call that happens to omit a flag.
  const concluirComoGerente = useCallback(
    (idAtendimento: string, clientes: ClienteOutcomeInput[], checklist: ChecklistRespostaInput[]) =>
      runBooleanRpc(
        "concluir_atendimento_gerencial",
        {
          p_session_token: sessionToken,
          p_id_atendimento: idAtendimento,
          p_clientes: clientes,
          p_checklist: checklist,
          p_ignorar_checklist: false,
        },
        "concluir_atendimento_gerencial",
        true,
      ),
    [runBooleanRpc, sessionToken],
  );

  // Conclusão gerencial exception: the manager explicitly could not
  // validate the remaining checklist items (e.g. the employee is
  // unreachable to confirm what was actually done). checklist here is
  // whatever the manager genuinely ticked — never synthesized as complete
  // client-side; the server records this as checklist_validado = false
  // rather than silently accepting an incomplete checklist as if it were a
  // normal validated completion.
  const concluirComoGerenteSemValidarChecklist = useCallback(
    (idAtendimento: string, clientes: ClienteOutcomeInput[], checklist: ChecklistRespostaInput[]) =>
      runBooleanRpc(
        "concluir_atendimento_gerencial",
        {
          p_session_token: sessionToken,
          p_id_atendimento: idAtendimento,
          p_clientes: clientes,
          p_checklist: checklist,
          p_ignorar_checklist: true,
        },
        "concluir_atendimento_gerencial (sem validar checklist)",
        true,
      ),
    [runBooleanRpc, sessionToken],
  );

  return {
    submitting,
    errorMessage,
    iniciar,
    cancelar,
    iniciarFechamento,
    voltarAoAtendimento,
    concluir,
    adiarChecklist,
    concluirPendente,
    iniciarFechamentoComoGerente,
    concluirComoGerente,
    concluirComoGerenteSemValidarChecklist,
  };
}
