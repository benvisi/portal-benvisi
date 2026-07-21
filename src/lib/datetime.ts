import { LOCALE_PT_BR, MANAUS_TIMEZONE } from "@/config/constants";

function getManausHour(date: Date): number {
  const hourText = new Intl.DateTimeFormat(LOCALE_PT_BR, {
    timeZone: MANAUS_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number.parseInt(hourText, 10);
}

export function getManausGreeting(date: Date = new Date()): string {
  const hour = getManausHour(date);
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
