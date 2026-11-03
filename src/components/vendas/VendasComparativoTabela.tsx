import {
  RELATORIO_VENDAS_COMPARATIVO_ARIA_LABEL,
  RELATORIO_VENDAS_COMPARATIVO_COLUNAS,
  RELATORIO_VENDAS_COMPARATIVO_ROTULO_COLUNA,
  RELATORIO_VENDAS_COMPARATIVO_VARIACAO_LABEL,
} from "@/config/constants";
import { cn } from "@/lib/utils";
import {
  formatVariacao,
  montarLinhasComparativo,
  tomVariacao,
  type VendasComparativoJanela,
  type VendasComparativoLinha,
  type VendasComparativoVariacoes,
} from "@/lib/vendasComparativo";
import { formatBrlWhole, formatInteger, formatPa, type VendasPeriodo } from "@/lib/vendasRelatorio";

interface VendasComparativoTabelaProps {
  periodo: VendasPeriodo;
  janelas: readonly VendasComparativoJanela[];
}

const TOM_CLASSES = {
  positivo: "text-emerald-700 dark:text-emerald-400",
  negativo: "text-red-700 dark:text-red-400",
  neutro: "text-muted-foreground",
} as const;

// Metric order = RELATORIO_VENDAS_COMPARATIVO_COLUNAS; each metric is followed by its %Δ.
const METRICAS: readonly {
  valor: (linha: VendasComparativoLinha) => string;
  variacao: keyof VendasComparativoVariacoes;
}[] = [
  { valor: (l) => formatBrlWhole(l.janela.venda_liquida), variacao: "venda" },
  { valor: (l) => formatInteger(l.janela.pecas_liquidas), variacao: "pecas" },
  { valor: (l) => formatInteger(l.janela.tickets), variacao: "tickets" },
  { valor: (l) => formatPa(l.janela.pa), variacao: "pa" },
  { valor: (l) => formatBrlWhole(l.janela.ticket_medio), variacao: "ticketMedio" },
  { valor: (l) => formatBrlWhole(l.janela.pm), variacao: "pm" },
];

const PRIMEIRA_COLUNA = "w-[5.75rem] min-w-[5.75rem]";
const COLUNA_VALOR = "min-w-[4.5rem]";
const COLUNA_VARIACAO = "min-w-[3.75rem]";

function Linha({ linha }: { linha: VendasComparativoLinha }) {
  return (
    <tr
      data-atual={linha.atual ? "true" : undefined}
      className={cn(
        "bg-card even:bg-zebra [&>*]:border-b [&>*]:border-b-border/60",
        linha.atual && "font-semibold",
      )}
    >
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 truncate border-r-2 border-brand bg-inherit px-2 py-2.5 text-left font-medium text-foreground",
          PRIMEIRA_COLUNA,
        )}
      >
        {linha.rotulo}
      </th>
      {METRICAS.flatMap((metrica) => {
        const variacao = linha.variacoes[metrica.variacao];
        return [
          <td
            key={`${metrica.variacao}-valor`}
            className={cn("whitespace-nowrap px-2 py-2.5 text-right tabular-nums", COLUNA_VALOR)}
          >
            {metrica.valor(linha)}
          </td>,
          <td
            key={`${metrica.variacao}-delta`}
            className={cn(
              "whitespace-nowrap px-2 py-2.5 text-right text-xs font-medium tabular-nums",
              COLUNA_VARIACAO,
              TOM_CLASSES[tomVariacao(variacao)],
            )}
          >
            {formatVariacao(variacao)}
          </td>,
        ];
      })}
    </tr>
  );
}

/**
 * Store-level comparison: one row per comparison year/window (oldest first),
 * each metric followed by its %Δ against the previous row. The first column
 * is sticky; on narrow screens the rest scrolls horizontally instead of
 * being squeezed.
 */
export function VendasComparativoTabela({ periodo, janelas }: VendasComparativoTabelaProps) {
  const linhas = montarLinhasComparativo(periodo, janelas);

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table
        aria-label={RELATORIO_VENDAS_COMPARATIVO_ARIA_LABEL}
        className="w-full border-separate border-spacing-0 text-sm"
      >
        <thead>
          <tr className="bg-brand text-xs uppercase tracking-wide text-brand-foreground">
            <th
              scope="col"
              className={cn(
                "sticky left-0 z-20 border-r-2 border-brand bg-brand px-2 py-2.5 text-left font-semibold",
                PRIMEIRA_COLUNA,
              )}
            >
              {RELATORIO_VENDAS_COMPARATIVO_ROTULO_COLUNA}
            </th>
            {RELATORIO_VENDAS_COMPARATIVO_COLUNAS.flatMap((coluna) => [
              <th
                key={`${coluna}-valor`}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-2 py-2.5 text-right font-semibold",
                  COLUNA_VALOR,
                )}
              >
                {coluna}
              </th>,
              <th
                key={`${coluna}-delta`}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-2 py-2.5 text-right font-semibold",
                  COLUNA_VARIACAO,
                )}
              >
                {RELATORIO_VENDAS_COMPARATIVO_VARIACAO_LABEL}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <Linha key={linha.janela.anos_atras} linha={linha} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
