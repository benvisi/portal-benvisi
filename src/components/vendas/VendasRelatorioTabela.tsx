import { RELATORIO_VENDAS_COLUMNS } from "@/config/constants";
import { cn } from "@/lib/utils";
import {
  formatBrl,
  formatBrlWhole,
  formatInteger,
  formatPa,
  getVendasLinhaLabel,
  organizarLinhasVendas,
  type VendasMetricasLinha,
} from "@/lib/vendasRelatorio";

interface VendasRelatorioTabelaProps {
  linhas: readonly VendasMetricasLinha[];
}

// Comfortable minimum widths; portrait phones scroll horizontally.
const COLUMN_WIDTHS = [
  "w-[6.5rem] min-w-[6.5rem]",
  "min-w-[6rem]",
  "min-w-[5rem]",
  "min-w-[5rem]",
  "min-w-[6rem]",
  "min-w-[5rem]",
  "min-w-[4.5rem]",
  "min-w-[7.5rem]",
  "min-w-[6rem]",
];

type RowKind = "vendedor" | "outros" | "total";

// Opaque row fills: the sticky Vendedor cell must not let scrolled content
// show through, so the same fill is applied to every cell of the row.
const ROW_STYLES: Record<RowKind, string> = {
  vendedor: "bg-card even:bg-zebra",
  outros: "bg-secondary italic text-muted-foreground",
  total: "bg-zebra-header font-bold text-foreground [&>*]:border-t-2 [&>*]:border-t-brand",
};

function Linha({ linha, kind }: { linha: VendasMetricasLinha; kind: RowKind }) {
  const valores = [
    formatBrlWhole(linha.venda_liquida),
    formatInteger(linha.pecas_brutas),
    formatInteger(linha.pecas_troca),
    formatInteger(linha.pecas_liquidas),
    formatInteger(linha.tickets),
    formatPa(linha.pa),
    formatBrl(linha.ticket_medio),
    formatBrl(linha.pm),
  ];
  return (
    <tr className={cn("[&>*]:border-b [&>*]:border-b-border/60", ROW_STYLES[kind])}>
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 truncate border-r-2 border-brand bg-inherit px-3 py-2.5 text-left",
          kind === "vendedor" && "font-medium text-foreground",
          COLUMN_WIDTHS[0],
        )}
      >
        {getVendasLinhaLabel(linha)}
      </th>
      {valores.map((valor, i) => (
        <td
          key={RELATORIO_VENDAS_COLUMNS[i + 1]}
          className={cn(
            "whitespace-nowrap px-3 py-2.5 text-right tabular-nums",
            COLUMN_WIDTHS[i + 1],
          )}
        >
          {valor}
        </td>
      ))}
    </tr>
  );
}

/**
 * One responsive table for every viewport: Vendedor is sticky on the left
 * with a continuous dark-green divider (border-r on every cell of the first
 * column, header to Total); the table fills the available width on larger
 * screens and scrolls horizontally as a fallback on narrow ones.
 */
export function VendasRelatorioTabela({ linhas }: VendasRelatorioTabelaProps) {
  const { vendedores, outros, total } = organizarLinhasVendas(linhas);

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-brand text-xs uppercase tracking-wide text-brand-foreground">
            {RELATORIO_VENDAS_COLUMNS.map((coluna, i) => (
              <th
                key={coluna}
                scope="col"
                className={cn(
                  "px-3 py-2.5 font-semibold",
                  i === 0
                    ? "sticky left-0 z-20 border-r-2 border-brand bg-brand text-left"
                    : "text-right",
                  COLUMN_WIDTHS[i],
                  coluna === "Ticket Méd." && "whitespace-nowrap",
                )}
              >
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vendedores.map((linha) => (
            <Linha
              key={linha.funcionario_id ?? linha.vendedor_nome}
              linha={linha}
              kind="vendedor"
            />
          ))}
          {outros && <Linha linha={outros} kind="outros" />}
          {total && <Linha linha={total} kind="total" />}
        </tbody>
      </table>
    </div>
  );
}
