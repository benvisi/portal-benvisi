import {
  ESTOQUE_COR_COLUNA_LABEL,
  ESTOQUE_PRECO_AUSENTE_LABEL,
  ESTOQUE_PRECO_COLUNA_LABEL,
  ESTOQUE_TAMANHO_BR_AUSENTE_LABEL,
  ESTOQUE_TAMANHO_BR_LABEL,
  ESTOQUE_TAMANHO_UK_LABEL,
} from "@/config/constants";
import { converterUkParaBr, normalizeTamanhoCalcado } from "@/lib/conversaoTamanhoCalcado";
import { formatEstoquePreco, type EstoqueMatriz } from "@/lib/estoque";
import { cn } from "@/lib/utils";

interface EstoqueMatrixProps {
  matriz: EstoqueMatriz;
}

/**
 * The locked stock-detail model: ONE coherent colour x applicable-size table.
 *
 * - rows = colours: `cor_codigo` is the primary operational identifier
 *   (prominent / semibold), `cor_nome_portal` the secondary descriptor
 *   (muted, smaller, allowed to wrap — never `cor_descricao_linx`). X-axis =
 *   the produto's real applicable `tamanho_venda` positions ordered by
 *   `tamanho_key` (dynamic — never a hard-coded grade, `tamanho_key` never
 *   shown).
 * - Real operational table: every quantity sits in a bordered cell, header
 *   row and colour column clearly separated. Positive quantity shows the
 *   number; a known 0 shows an empty bordered cell (never a literal "0",
 *   never a colour-coded status). The header row uses the same `--brand`
 *   green as the Dashboard tiles (`bg-brand`/`text-brand-foreground`, the
 *   same pairing `ModuleCard` uses) rather than another approximation of
 *   it, with `border-brand-foreground/15` dividers — the same subtle-on-
 *   brand convention `ModuleCard` uses for its icon wrapper — for a clear
 *   strong-header vs pale-striped-body hierarchy.
 * - Subtle zebra striping across the colour rows, using the shared `--zebra`
 *   brand-green tint (not a red/yellow/green status colour), continuing
 *   through the sticky colour column so each row stays visually coherent
 *   while scrolling.
 * - Horizontal (and vertical) scrolling is contained in this region so the
 *   page never overflows sideways; the colour column and the size header stay
 *   pinned. `border-separate` keeps each cell's gridlines attached to it when
 *   it is the sticky cell (a plain `border-collapse` table drops them there).
 * - Price V1: one Preço column, right after Cor, holding the full/list price
 *   for that colour (never per-size). Only the Cor column is sticky — a
 *   second sticky column adds real width/z-index complexity on narrow
 *   viewports for one column's worth of benefit, so Preço scrolls with the
 *   size grade instead (locked decision: keep it simple). A missing price
 *   shows the neutral ESTOQUE_PRECO_AUSENTE_LABEL, never a manufactured
 *   value.
 * - Footwear UK/BR size conversion (20260925): when `matriz.segmentoCalcado`
 *   is set (grade F1/F2/F62 — see src/lib/conversaoTamanhoCalcado), the
 *   header grows from one row to two: a UK row (brand-green, matching the
 *   original header — this IS the source/Linx sizing) and a BR row right
 *   below it (a light brand tint, same hue family, visually lighter/derived
 *   rather than an unrelated colour) with an explicit "UK"/"BR" text label
 *   in a narrow gutter column between Preço and the size columns — colour
 *   is supplementary, the labels are what make each row unambiguous. Cor
 *   and Preço span both header rows via rowSpan so their column stays a
 *   single cell; the label gutter mirrors that with a single rowSpan cell
 *   across every colour row in the body (kept empty/neutral — it exists
 *   only to carry the UK/BR row labels in the header). The UK row shows the
 *   size normalized for display only (strips a trailing-comma artifact,
 *   never a legitimate decimal comma) — tamanho_venda itself is untouched.
 *   A size with no supplied BR mapping shows ESTOQUE_TAMANHO_BR_AUSENTE_LABEL
 *   rather than hiding the column or inventing a conversion. Non-footwear
 *   matrices (segmentoCalcado null) render exactly as before.
 */
export function EstoqueMatrix({ matriz }: EstoqueMatrixProps) {
  const segmento = matriz.segmentoCalcado;
  const isCalcado = segmento !== null;
  const headerRowSpan = isCalcado ? 2 : 1;

  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-border">
      <table className="w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              rowSpan={headerRowSpan}
              className="sticky left-0 top-0 z-30 min-w-[8.5rem] max-w-[12rem] border-b-2 border-r-2 border-brand-foreground/15 bg-brand px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-brand-foreground"
            >
              {ESTOQUE_COR_COLUNA_LABEL}
            </th>
            <th
              scope="col"
              rowSpan={headerRowSpan}
              className="sticky top-0 z-20 min-w-[5rem] border-b-2 border-r-2 border-brand-foreground/15 bg-brand px-2 py-2 text-center text-xs font-semibold text-brand-foreground"
            >
              {ESTOQUE_PRECO_COLUNA_LABEL}
            </th>
            {isCalcado && (
              <th
                scope="col"
                className="sticky top-0 z-20 min-w-[2.5rem] border-b border-r-2 border-brand-foreground/15 bg-brand px-2 py-2 text-center text-[0.65rem] font-bold uppercase tracking-wide text-brand-foreground"
              >
                {ESTOQUE_TAMANHO_UK_LABEL}
              </th>
            )}
            {matriz.tamanhos.map((tamanho) => (
              <th
                key={tamanho.key}
                scope="col"
                className={cn(
                  "sticky top-0 z-20 min-w-[3.25rem] px-2 py-2 text-center text-xs font-semibold text-brand-foreground",
                  "border-r border-brand-foreground/15 bg-brand",
                  isCalcado ? "border-b border-brand-foreground/15" : "border-b-2",
                )}
              >
                {isCalcado ? normalizeTamanhoCalcado(tamanho.venda) : tamanho.venda}
              </th>
            ))}
          </tr>
          {isCalcado && (
            <tr>
              <th
                scope="col"
                className="sticky top-8 z-20 min-w-[2.5rem] border-b-2 border-r-2 border-brand/20 bg-brand/10 px-2 py-2 text-center text-[0.65rem] font-bold uppercase tracking-wide text-brand"
              >
                {ESTOQUE_TAMANHO_BR_LABEL}
              </th>
              {matriz.tamanhos.map((tamanho) => {
                const tamanhoBr = converterUkParaBr(segmento, tamanho.venda);
                return (
                  <th
                    key={tamanho.key}
                    scope="col"
                    className="sticky top-8 z-20 min-w-[3.25rem] border-b-2 border-r border-brand/20 bg-brand/10 px-2 py-2 text-center text-xs font-semibold text-brand"
                  >
                    {tamanhoBr !== undefined ? tamanhoBr : ESTOQUE_TAMANHO_BR_AUSENTE_LABEL}
                  </th>
                );
              })}
            </tr>
          )}
        </thead>
        <tbody>
          {matriz.cores.map((cor, index) => {
            // Brand-tinted alternating fill (see --zebra in styles.css) — a
            // step lighter than the card so the gridlines stay visible over
            // both bands. Applied to the sticky colour cell too, so its
            // stripe never detaches while scrolling.
            const stripe = index % 2 === 1 ? "bg-zebra" : "bg-card";
            return (
              <tr key={cor.codigo}>
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 min-w-[8.5rem] max-w-[12rem] border-b border-r-2 border-border px-3 py-2 text-left align-top font-normal",
                    stripe,
                  )}
                >
                  <span className="font-semibold text-foreground">{cor.codigo}</span>{" "}
                  <span className="text-xs text-muted-foreground">{cor.nome}</span>
                </th>
                <td
                  className={cn(
                    "border-b border-r-2 border-border px-2 py-2 text-center tabular-nums text-foreground",
                    stripe,
                  )}
                >
                  {cor.preco !== null ? formatEstoquePreco(cor.preco) : ESTOQUE_PRECO_AUSENTE_LABEL}
                </td>
                {isCalcado && index === 0 && (
                  <td
                    rowSpan={matriz.cores.length}
                    aria-hidden
                    className="border-b border-r-2 border-border bg-card px-2 py-2"
                  />
                )}
                {matriz.tamanhos.map((tamanho) => {
                  const quantidade = cor.quantidades.get(tamanho.key) ?? 0;
                  return (
                    <td
                      key={tamanho.key}
                      className={cn(
                        "border-b border-r border-border px-2 py-2 text-center tabular-nums text-foreground",
                        stripe,
                      )}
                    >
                      {quantidade > 0 ? quantidade : ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
