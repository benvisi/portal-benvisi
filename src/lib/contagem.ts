import { LOCALE_PT_BR, MANAUS_TIMEZONE } from "@/config/constants";
import { familiaLabel, familiaOrdem } from "@/config/contagem-embalagens";
import type { ContagemCatalogoItem } from "@/integrations/supabase/contracts";

/**
 * Milestone 4D — pure helpers for the Contagem de Embalagens form and
 * review screens. No React, no data fetching. The single source of the
 * total formula is here, matching the backend derivation exactly:
 *   pacotes_fechados * unidades_por_pacote + unidades_avulsas
 */

export function calcularTotalUnidades(
  pacotesFechados: number,
  unidadesAvulsas: number,
  unidadesPorPacote: number,
): number {
  return pacotesFechados * unidadesPorPacote + unidadesAvulsas;
}

/**
 * Parses a raw count-field string. Empty string is `null` ("not informed"),
 * never silently 0 — the caller decides what a missing value means
 * (blocked for Pacotes fechados, treated as 0 for Unidades avulsas). Only
 * nonnegative whole integers are accepted; anything else is `null`.
 */
export function parseContagemInteiro(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Keeps only digits and drops leading zeros (except a lone "0"). */
export function sanitizeContagemInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

export function formatUnidades(total: number): string {
  return total.toLocaleString(LOCALE_PT_BR);
}

/** "26/09/2026 · 18:32" — Manaus local time, for pending/history cards. */
export function formatContagemDataHora(iso: string): string {
  const date = new Date(iso);
  const data = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const hora = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${data} · ${hora}`;
}

export interface CatalogoGrupo {
  familia: string;
  label: string;
  itens: ContagemCatalogoItem[];
}

/**
 * Groups the flat catalog into display blocks by `familia`, groups ordered
 * by CONTAGEM_FAMILIA_ORDEM and items within a group kept in the RPC's
 * `ordem_exibicao` order.
 */
export function agruparCatalogoPorFamilia(itens: readonly ContagemCatalogoItem[]): CatalogoGrupo[] {
  const porFamilia = new Map<string, ContagemCatalogoItem[]>();
  for (const item of itens) {
    const bucket = porFamilia.get(item.familia);
    if (bucket) bucket.push(item);
    else porFamilia.set(item.familia, [item]);
  }

  return [...porFamilia.entries()]
    .map(([familia, grupoItens]) => ({
      familia,
      label: familiaLabel(familia),
      itens: [...grupoItens].sort((a, b) => a.ordem_exibicao - b.ordem_exibicao),
    }))
    .sort(
      (a, b) => familiaOrdem(a.familia) - familiaOrdem(b.familia) || a.label.localeCompare(b.label),
    );
}
