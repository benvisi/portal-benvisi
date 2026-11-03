import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RELATORIO_VENDAS_PERIODO_ARIA_LABEL, RELATORIO_VENDAS_PERIODOS } from "@/config/constants";
import { isVendasPeriodo, type VendasPeriodo } from "@/lib/vendasRelatorio";

interface VendasPeriodoSeletorProps {
  value: VendasPeriodo;
  onChange: (periodo: VendasPeriodo) => void;
}

/** Compact underline tabs for the report period (Hoje | Mês | Ano | 12M). */
export function VendasPeriodoSeletor({ value, onChange }: VendasPeriodoSeletorProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (isVendasPeriodo(next)) onChange(next);
      }}
    >
      <TabsList
        aria-label={RELATORIO_VENDAS_PERIODO_ARIA_LABEL}
        className="h-auto gap-1 rounded-none bg-transparent p-0"
      >
        {RELATORIO_VENDAS_PERIODOS.map((periodo) => (
          <TabsTrigger
            key={periodo.value}
            value={periodo.value}
            className="min-h-11 rounded-none border-b-2 border-transparent px-3 text-muted-foreground data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {periodo.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
