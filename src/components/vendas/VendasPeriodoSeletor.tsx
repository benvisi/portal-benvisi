import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RELATORIO_VENDAS_PERIODO_ARIA_LABEL, RELATORIO_VENDAS_PERIODOS } from "@/config/constants";
import { isVendasPeriodo, type VendasPeriodo } from "@/lib/vendasRelatorio";

interface VendasPeriodoSeletorProps {
  value: VendasPeriodo;
  onChange: (periodo: VendasPeriodo) => void;
}

/** Segmented period selector for Relatório de vendas (Hoje | Mês | Ano | Últimos 12 meses). */
export function VendasPeriodoSeletor({ value, onChange }: VendasPeriodoSeletorProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (isVendasPeriodo(next)) onChange(next);
      }}
      className="px-2.5"
    >
      <TabsList
        aria-label={RELATORIO_VENDAS_PERIODO_ARIA_LABEL}
        className="grid h-auto w-full grid-cols-4 gap-1"
      >
        {RELATORIO_VENDAS_PERIODOS.map((periodo) => (
          // "Últimos 12 meses" wraps onto two lines on narrow phones instead of being abbreviated.
          <TabsTrigger
            key={periodo.value}
            value={periodo.value}
            className="min-h-11 whitespace-normal px-1 text-center leading-tight"
          >
            {periodo.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
