import { HAPTIC_ERROR_PATTERN, HAPTIC_SUCCESS_PATTERN, HAPTIC_TAP_MS } from "@/config/constants";

export type HapticPattern = "tap" | "success" | "error";

function resolvePattern(pattern: HapticPattern): number | readonly number[] {
  if (pattern === "success") return HAPTIC_SUCCESS_PATTERN;
  if (pattern === "error") return HAPTIC_ERROR_PATTERN;
  return HAPTIC_TAP_MS;
}

export const HapticService = {
  vibrate(pattern: HapticPattern = "tap"): void {
    if (typeof window === "undefined") return;
    const nav = window.navigator;
    if (typeof nav?.vibrate !== "function") return;
    const value = resolvePattern(pattern);
    nav.vibrate(value as number | number[]);
  },
};
