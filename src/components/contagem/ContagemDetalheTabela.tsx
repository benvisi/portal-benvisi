import {
  CONTAGEM_COL_AVULSAS_LABEL,
  CONTAGEM_COL_ITEM_LABEL,
  CONTAGEM_COL_PACOTES_LABEL,
  CONTAGEM_COL_TOTAL_LABEL,
} from "@/config/constants";
import type { ContagemDetalheLinha } from "@/integrations/supabase/contracts";
import { formatUnidades } from "@/lib/contagem";

interface ContagemDetalheTabelaProps {
  linhas: readonly ContagemDetalheLinha[];
}

/**
 * The item breakdown for one submission: item, pacotes fechados, unidades
 * avulsas, and the per-item total (pacotes × unidades_por_pacote +
 * avulsas). No cross-category grand total — summing heterogeneous
 * packaging items is not operationally meaningful. Even rows take the
 * neutral `--border` design token as a fill (`bg-border` — a step darker
 * than `bg-muted`, still a light grey, no hue) so the zebra striping is
 * unmistakable on a phone at rest without reading as heavy; it aids
 * left-to-right tracking across the four columns. Odd rows keep the card
 * background. Kept in its own overflow-x-auto container so a narrow screen
 * scrolls the table rather than the page.
 */
export function ContagemDetalheTabela({ linhas }: ContagemDetalheTabelaProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[22rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              {CONTAGEM_COL_ITEM_LABEL}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {CONTAGEM_COL_PACOTES_LABEL}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {CONTAGEM_COL_AVULSAS_LABEL}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {CONTAGEM_COL_TOTAL_LABEL}
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr
              key={linha.id_item}
              className="border-b border-border/60 last:border-b-0 even:bg-border"
            >
              <td className="px-3 py-2 text-left text-foreground">{linha.rotulo}</td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {formatUnidades(linha.pacotes_fechados)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {formatUnidades(linha.unidades_avulsas)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                {formatUnidades(linha.total_unidades)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
