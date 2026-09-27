import { LOCALE_PT_BR, MANAUS_TIMEZONE } from "@/config/constants";
import type {
  AtendimentoResumoHojeLinha,
  MotivoCategoria,
} from "@/integrations/supabase/contracts";

/**
 * Card #36 — pure helpers. All eligibility/date-boundary logic lives in SQL
 * (supabase/migrations/20260925_107_add_atendimento_resumo_hoje.sql); this
 * module only aggregates and formats the flat payload the RPC already
 * returns.
 */

/** "10:18" — Manaus local time, for an atendimento's start time. */
export function formatAtendimentoResumoHora(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Rounds to the nearest whole percent; null when there is nothing to divide by. */
export function calcularConversaoPercentual(
  convertidos: number,
  totalOutcomes: number,
): number | null {
  if (totalOutcomes <= 0) return null;
  return Math.round((convertidos / totalOutcomes) * 100);
}

export interface AtendimentoResumoOutcome {
  id: string;
  categoria: MotivoCategoria;
  motivoRotulo: string;
  detalhe: string | null;
}

export interface AtendimentoResumoItem {
  idAtendimento: string;
  iniciadoEm: string;
  outcomes: AtendimentoResumoOutcome[];
}

export interface AtendimentoResumoAtendimentoItem extends AtendimentoResumoItem {
  funcionarioNome: string;
}

export interface AtendimentoResumoVendedor {
  funcionarioId: string;
  nome: string;
  atendimentos: AtendimentoResumoItem[];
  totalAtendimentos: number;
  totalConvertidos: number;
  totalOutcomes: number;
}

export interface AtendimentoResumoHoje {
  totalAtendimentos: number;
  totalConvertidos: number;
  totalOutcomes: number;
  porVendedor: AtendimentoResumoVendedor[];
  porAtendimento: AtendimentoResumoAtendimentoItem[];
}

/**
 * Aggregates the flat get_atendimento_resumo_hoje payload into both the "Por
 * vendedor" and "Por atendimento" views in a single pass — no second RPC.
 *
 * "Por vendedor" keeps the RPC's own row order (vendedor apelido asc — never
 * a performance ranking — then iniciado_em desc within each vendedor).
 * "Por atendimento" is a separate global sort by iniciado_em desc across
 * every vendedor, since the RPC only orders desc WITHIN each vendedor's own
 * rows, not across the whole result set.
 */
export function agruparAtendimentoResumoHoje(
  linhas: AtendimentoResumoHojeLinha[],
): AtendimentoResumoHoje {
  const vendedores = new Map<string, AtendimentoResumoVendedor>();
  const atendimentosPorId = new Map<string, AtendimentoResumoAtendimentoItem>();

  for (const linha of linhas) {
    let vendedor = vendedores.get(linha.funcionario_id);
    if (!vendedor) {
      vendedor = {
        funcionarioId: linha.funcionario_id,
        nome: linha.funcionario_nome,
        atendimentos: [],
        totalAtendimentos: 0,
        totalConvertidos: 0,
        totalOutcomes: 0,
      };
      vendedores.set(linha.funcionario_id, vendedor);
    }

    if (linha.id_atendimento === null || linha.iniciado_em === null) continue;

    let item = atendimentosPorId.get(linha.id_atendimento);
    if (!item) {
      item = {
        idAtendimento: linha.id_atendimento,
        iniciadoEm: linha.iniciado_em,
        funcionarioNome: linha.funcionario_nome,
        outcomes: [],
      };
      atendimentosPorId.set(linha.id_atendimento, item);
      vendedor.atendimentos.push(item);
      vendedor.totalAtendimentos += 1;
    }

    if (
      linha.id_atendimento_cliente !== null &&
      linha.categoria !== null &&
      linha.motivo_rotulo !== null
    ) {
      item.outcomes.push({
        id: linha.id_atendimento_cliente,
        categoria: linha.categoria,
        motivoRotulo: linha.motivo_rotulo,
        detalhe: linha.detalhe,
      });
      vendedor.totalOutcomes += 1;
      if (linha.categoria === "convertido") vendedor.totalConvertidos += 1;
    }
  }

  const porVendedor = Array.from(vendedores.values());
  const porAtendimento = Array.from(atendimentosPorId.values()).sort(
    (a, b) => new Date(b.iniciadoEm).getTime() - new Date(a.iniciadoEm).getTime(),
  );

  const totalAtendimentos = porAtendimento.length;
  const totalOutcomes = porVendedor.reduce((sum, v) => sum + v.totalOutcomes, 0);
  const totalConvertidos = porVendedor.reduce((sum, v) => sum + v.totalConvertidos, 0);

  return { totalAtendimentos, totalConvertidos, totalOutcomes, porVendedor, porAtendimento };
}
