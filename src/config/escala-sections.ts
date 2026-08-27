import type { EscalaSecao } from "@/integrations/supabase/contracts";

/**
 * Per-section colour treatment for the Escala views (Milestone 4C.2 browser
 * QA). Presentation only — no effect on classification, ordering, or copy.
 *
 * Hues are deliberately semantic and, where one already exists in the app,
 * reused:
 *   - manha        → amber / "sunrise" (warm, start of day);
 *   - tarde        → light blue (matches --info, "later in the day");
 *   - intermediario→ soft lavender (hue 300) — the exact family already used
 *                    for a Mixed Atendimento (src/config/atendimento-feedback
 *                    .ts), i.e. "distinct, not a warning";
 *   - folga        → green — the colour employees already associate with a
 *                    day off in the legacy Excel schedule;
 *   - ferias       → near-neutral grey (a planned, longer absence — calm,
 *                    recedes);
 *   - a_confirmar  → soft red — draws the eye ("incomplete, check with the
 *                    admin") without being the hard error state.
 *
 * There is no `gestao` entry: gerência employees are bucketed into the
 * sections above like everyone else (20260826_002_bucket_gestao_into_normal
 * _sections.sql); their hours arrive null so their rows render name-only.
 *
 * Every value is a light, low-chroma oklch — a tint for a surface, never a
 * saturated fill — with text kept dark enough for comfortable contrast on
 * its own `bg`. Applied via inline style (same approach as the Atendimento
 * toast palette) rather than Tailwind classes, since these are one-off
 * domain colours, not part of the design-token scale.
 */
export interface EscalaSecaoPalette {
  /** Section container tint. */
  bg: string;
  /** Slightly stronger tint for the individual employee rows inside it. */
  bgRow: string;
  /** Container border + hairline under the row chips. */
  border: string;
  /** Section heading text (and the hours shown next to it). */
  text: string;
}

export const ESCALA_SECAO_PALETTE: Record<EscalaSecao, EscalaSecaoPalette> = {
  manha: {
    bg: "oklch(0.965 0.035 78)",
    bgRow: "oklch(0.95 0.055 78)",
    border: "oklch(0.86 0.09 75)",
    text: "oklch(0.44 0.10 65)",
  },
  intermediario: {
    bg: "oklch(0.965 0.02 300)",
    bgRow: "oklch(0.95 0.03 300)",
    border: "oklch(0.85 0.06 300)",
    text: "oklch(0.42 0.12 300)",
  },
  tarde: {
    bg: "oklch(0.965 0.025 235)",
    bgRow: "oklch(0.95 0.04 235)",
    border: "oklch(0.84 0.07 235)",
    text: "oklch(0.42 0.11 235)",
  },
  folga: {
    bg: "oklch(0.96 0.04 152)",
    bgRow: "oklch(0.94 0.06 152)",
    border: "oklch(0.83 0.10 152)",
    text: "oklch(0.40 0.10 152)",
  },
  ferias: {
    bg: "oklch(0.965 0.004 255)",
    bgRow: "oklch(0.95 0.006 255)",
    border: "oklch(0.88 0.006 255)",
    text: "oklch(0.48 0.015 255)",
  },
  a_confirmar: {
    bg: "oklch(0.965 0.022 25)",
    bgRow: "oklch(0.95 0.035 25)",
    border: "oklch(0.87 0.07 25)",
    text: "oklch(0.50 0.14 25)",
  },
};
