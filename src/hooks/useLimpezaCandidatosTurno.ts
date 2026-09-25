import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { isEscalaEntradaPeriodo } from "@/integrations/supabase/contracts";
import type { LimpezaTurno } from "@/integrations/supabase/contracts";

/**
 * Candidates for a Gerente/Administrador manual override: every funcionario
 * actually scheduled 'trabalho' on this date whose shift classifies as this
 * turno (reuses get_escala_periodo, already granted to anon — no new Escala
 * read RPC needed). The server-side RPC re-validates eligibility regardless
 * of what this list shows.
 */
export function useLimpezaCandidatosTurno(
  sessionToken: string | null,
  data: string,
  turno: LimpezaTurno,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["limpeza-candidatos-turno", data, turno],
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc("get_escala_periodo", {
        p_session_token: sessionToken as string,
        p_data_inicio: data,
        p_data_fim: data,
      });
      if (error) throw error;
      const entradas = Array.isArray(rows) ? rows.filter(isEscalaEntradaPeriodo) : [];
      return entradas
        .filter((entrada) => entrada.secao === turno)
        .map((entrada) => ({ id: entrada.id_funcionario, apelido: entrada.apelido }))
        .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
    },
    enabled: enabled && sessionToken !== null,
  });
}
