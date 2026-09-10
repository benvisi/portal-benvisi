import { ESTOQUE_COR_COLUNA_LABEL } from "@/config/constants";
import type { EstoqueMatriz } from "@/lib/estoque";
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
 *   never a colour-coded status).
 * - Subtle neutral zebra striping across the colour rows (no red/yellow/green
 *   semantics), continuing through the sticky colour column so each row stays
 *   visually coherent while scrolling.
 * - Horizontal (and vertical) scrolling is contained in this region so the
 *   page never overflows sideways; the colour column and the size header stay
 *   pinned. `border-separate` keeps each cell's gridlines attached to it when
 *   it is the sticky cell (a plain `border-collapse` table drops them there).
 */
export function EstoqueMatrix({ matriz }: EstoqueMatrixProps) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-border">
      <table className="w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-30 min-w-[8.5rem] max-w-[12rem] border-b-2 border-r-2 border-border bg-accent px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {ESTOQUE_COR_COLUNA_LABEL}
            </th>
            {matriz.tamanhos.map((tamanho) => (
              <th
                key={tamanho.key}
                scope="col"
                className="sticky top-0 z-20 min-w-[3.25rem] border-b-2 border-r border-border bg-accent px-2 py-2 text-center text-xs font-semibold text-foreground"
              >
                {tamanho.venda}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matriz.cores.map((cor, index) => {
            // Neutral alternating fill — a step lighter than the card so the
            // gridlines stay visible over both bands. Applied to the sticky
            // colour cell too, so its stripe never detaches while scrolling.
            const stripe = index % 2 === 1 ? "bg-muted" : "bg-card";
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
