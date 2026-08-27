import { LOCALE_PT_BR, MANAUS_TIMEZONE } from "@/config/constants";
import type { EscalaSecao } from "@/integrations/supabase/contracts";

// Milestone 4C.1: every date this module handles is a plain calendar date
// (YYYY-MM-DD), never an instant — pinned to UTC midnight for arithmetic and
// always formatted back with timeZone "UTC" so the same calendar date comes
// out regardless of the browser's local timezone. MANAUS_TIMEZONE is used
// only once, in getManausDateISO, to answer "what is today's date in
// Manaus" from a real instant (`new Date()`) — mixing the two would shift
// dates by Manaus's UTC-4 offset.
function parseCalendarISO(dateISO: string): Date {
  return new Date(`${dateISO}T00:00:00Z`);
}

function toCalendarISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getManausDateISO(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANAUS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysISO(dateISO: string, days: number): string {
  const date = parseCalendarISO(dateISO);
  date.setUTCDate(date.getUTCDate() + days);
  return toCalendarISO(date);
}

export function monthStartISO(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

export function addMonthsISO(dateISO: string, months: number): string {
  const date = parseCalendarISO(monthStartISO(dateISO));
  date.setUTCMonth(date.getUTCMonth() + months);
  return toCalendarISO(date);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

// "Terça-feira, 15 de setembro" — no year, matching the approved Hoje
// header example; the reduced compact form used in Mês adds day/month
// numerals instead (formatEscalaDiaCompacto below).
export function formatEscalaDiaHeader(dateISO: string): string {
  const formatted = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parseCalendarISO(dateISO));
  return capitalize(formatted);
}

// "Ter., 15/09" — compact single-line form for Mês/Minha Escala rows.
export function formatEscalaDiaCompacto(dateISO: string): string {
  const formatted = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(parseCalendarISO(dateISO));
  return capitalize(formatted);
}

export function formatMesAno(dateISO: string): string {
  const formatted = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(parseCalendarISO(dateISO));
  return capitalize(formatted);
}

// Strips seconds from a Postgres `time` string ("10:00:00" -> "10:00").
export function formatHora(hora: string | null): string {
  return hora ? hora.slice(0, 5) : "";
}

export function isSecaoComHorario(secao: EscalaSecao): boolean {
  return secao === "manha" || secao === "intermediario" || secao === "tarde";
}

// Display order (Milestone 4C.2 browser QA): shift sections first in
// chronological order, then absences, then the incomplete-data fallback.
// Gerência employees are bucketed into these same sections — there is no
// separate Gestão block. Sections with zero members for a given day are
// omitted by the caller, never rendered empty.
export const ESCALA_SECAO_ORDEM: readonly EscalaSecao[] = [
  "manha",
  "intermediario",
  "tarde",
  "folga",
  "ferias",
  "a_confirmar",
];

export function agruparEntradasPorSecao<T extends { secao: EscalaSecao; apelido: string }>(
  entradas: readonly T[],
): Map<EscalaSecao, T[]> {
  const grupos = new Map<EscalaSecao, T[]>();
  for (const secao of ESCALA_SECAO_ORDEM) grupos.set(secao, []);
  for (const entrada of entradas) {
    grupos.get(entrada.secao)?.push(entrada);
  }
  for (const membros of grupos.values()) {
    membros.sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  }
  return grupos;
}
